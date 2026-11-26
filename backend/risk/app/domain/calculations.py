"""
Financial calculations using ``Decimal`` exclusively.

IMPORTANT: This module NEVER uses ``float`` for monetary values. All
arithmetic is performed with ``Decimal`` or exact integer minor units to
guarantee deterministic, auditable results suitable for financial systems.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal
from typing import Iterable, List

CURRENCY_SCALES: dict[str, int] = {
    "INR": 2,
    "USD": 2,
    "EUR": 2,
    "GBP": 2,
    "JPY": 0,
}


def get_currency_scale(currency: str) -> int:
    code = currency.upper()
    if code not in CURRENCY_SCALES:
        raise ValueError(f"Unsupported currency code: {currency}")
    return CURRENCY_SCALES[code]


def minor_to_decimal(amount_minor: int, currency: str = "INR") -> Decimal:
    """Convert integer minor units (e.g. paise) into exact Decimal major units."""
    scale = get_currency_scale(currency)
    divisor = Decimal(10) ** scale
    return (Decimal(amount_minor) / divisor).quantize(Decimal(10) ** -scale)


def decimal_to_minor(amount: Decimal, currency: str = "INR") -> int:
    """Convert Decimal major units to integer minor units using currency rounding."""
    rounded = round_money(amount, currency)
    scale = get_currency_scale(currency)
    factor = Decimal(10) ** scale
    return int(rounded * factor)


def round_money(amount: Decimal, currency: str = "INR") -> Decimal:
    """Round a monetary amount to currency decimal scale.

    Uses ``ROUND_HALF_EVEN`` (banker's rounding) for INR to prevent
    systematic rounding drift. Other currencies default to ``ROUND_HALF_UP``.
    """
    scale = get_currency_scale(currency)
    quant = Decimal(10) ** -scale
    rounding = ROUND_HALF_EVEN if currency.upper() == "INR" else ROUND_HALF_UP
    return amount.quantize(quant, rounding=rounding)


def calculate_fee(
    amount: Decimal,
    rate: Decimal,
    min_fee: Decimal = Decimal("0"),
    max_fee: Decimal = Decimal("999999999"),
    currency: str = "INR",
) -> Decimal:
    """Calculate a fee as ``amount * rate``, clamped to [min_fee, max_fee]."""
    if amount <= 0:
        raise ValueError("Amount must be positive for fee calculation.")
    if rate < 0:
        raise ValueError("Fee rate cannot be negative.")
    if min_fee > max_fee:
        raise ValueError("min_fee cannot exceed max_fee.")
    raw = amount * rate
    clamped = max(min_fee, min(raw, max_fee))
    return round_money(clamped, currency)


def calculate_interest(
    principal: Decimal,
    annual_rate: Decimal,
    days: int,
    currency: str = "INR",
) -> Decimal:
    """Calculate simple interest: ``principal * annual_rate * days / 365``."""
    if principal <= 0:
        raise ValueError("Principal must be positive.")
    if annual_rate < 0:
        raise ValueError("Annual rate cannot be negative.")
    if days < 1:
        raise ValueError("Days must be at least 1.")
    raw = principal * annual_rate * Decimal(days) / Decimal("365")
    return round_money(raw, currency)


def allocate_pro_rata(total_minor: int, weights: List[int]) -> List[int]:
    """Allocate an integer minor-unit total proportionally with zero remainder loss.

    Distributes rounding remainders 1 minor unit at a time to highest fractional
    remainders (Hamilton/Largest Remainder method) so sum(result) == total_minor.
    """
    if total_minor < 0:
        raise ValueError("Total minor units must be non-negative.")
    if not weights:
        raise ValueError("At least one allocation weight is required.")
    if any(w < 0 for w in weights):
        raise ValueError("Weights must be non-negative.")
    total_weight = sum(weights)
    if total_weight <= 0:
        raise ValueError("Sum of weights must be positive.")

    shares_decimal = [(Decimal(total_minor) * Decimal(w)) / Decimal(total_weight) for w in weights]
    floored = [int(s) for s in shares_decimal]
    remainder = total_minor - sum(floored)

    remainders = sorted(
        enumerate(s - Decimal(f) for s, f in zip(shares_decimal, floored)),
        key=lambda x: (-x[1], x[0]),
    )
    for idx, _ in remainders[:remainder]:
        floored[idx] += 1

    return floored


def calculate_statement_summary(entries: List[dict]) -> dict:
    """Summarise statement entries using Decimal only."""
    total_credits = Decimal("0")
    total_debits = Decimal("0")
    seen_currency: str | None = None

    for entry in entries:
        amt = Decimal(str(entry["amount"]))
        entry_cur = entry.get("currency", seen_currency or "INR").upper()
        get_currency_scale(entry_cur)
        if seen_currency is not None and entry_cur != seen_currency:
            raise ValueError(f"Mixed currency entries are prohibited: {seen_currency} vs {entry_cur}")
        seen_currency = entry_cur
        if amt >= 0:
            total_credits += amt
        else:
            total_debits += abs(amt)

    currency = seen_currency or "INR"
    return {
        "total_credits": round_money(total_credits, currency),
        "total_debits": round_money(total_debits, currency),
        "net": round_money(total_credits - total_debits, currency),
        "entry_count": len(entries),
        "currency": currency,
    }


def calculate_reconciliation_batch(
    internal_items: List[dict],
    provider_items: List[dict],
    default_currency: str = "INR",
) -> dict:
    """Compare internal payment records with provider settlement items using exact Decimal arithmetic."""
    default_cur = default_currency.upper()
    get_currency_scale(default_cur)

    internal_map: dict[str, tuple[Decimal, str]] = {}
    for row in internal_items:
        ref = str(row["reference"])
        amt = round_money(Decimal(str(row["amount"])), row.get("currency", default_cur))
        cur = str(row.get("currency", default_cur)).upper()
        internal_map[ref] = (amt, cur)

    seen_refs: set[str] = set()
    results: List[dict] = []
    matched_count = 0
    exception_count = 0
    total_provider = Decimal("0")
    total_internal = sum((amt for amt, _ in internal_map.values()), Decimal("0"))

    for item in provider_items:
        ref = str(item["reference"])
        p_cur = str(item.get("currency", default_cur)).upper()
        p_amt = round_money(Decimal(str(item["amount"])), p_cur)
        total_provider += p_amt

        if ref in seen_refs:
            results.append({"reference": ref, "classification": "DUPLICATE", "variance": p_amt})
            exception_count += 1
            continue

        seen_refs.add(ref)
        if ref not in internal_map:
            results.append({"reference": ref, "classification": "MISSING_INTERNAL", "variance": p_amt})
            exception_count += 1
            continue

        i_amt, i_cur = internal_map.pop(ref)
        if p_cur != i_cur:
            results.append({"reference": ref, "classification": "CURRENCY_MISMATCH", "variance": p_amt})
            exception_count += 1
        elif p_amt != i_amt:
            results.append({"reference": ref, "classification": "AMOUNT_MISMATCH", "variance": round_money(p_amt - i_amt, i_cur)})
            exception_count += 1
        else:
            results.append({"reference": ref, "classification": "MATCHED", "variance": round_money(Decimal("0"), i_cur)})
            matched_count += 1

    for ref, (i_amt, i_cur) in internal_map.items():
        results.append({"reference": ref, "classification": "MISSING_PROVIDER", "variance": round_money(-i_amt, i_cur)})
        exception_count += 1

    return {
        "currency": default_cur,
        "matched_count": matched_count,
        "exception_count": exception_count,
        "total_internal": round_money(total_internal, default_cur),
        "total_provider": round_money(total_provider, default_cur),
        "net_variance": round_money(total_provider - total_internal, default_cur),
        "items": results,
    }


def compute_velocity_window(
    events: Iterable[dict],
    window_minutes: int,
    reference_time: datetime | None = None,
    currency: str = "INR",
) -> dict:
    """Aggregate count and exact Decimal sum of transactions inside a rolling window."""
    if window_minutes <= 0:
        raise ValueError("window_minutes must be positive")
    now = reference_time or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    cutoff = now - timedelta(minutes=window_minutes)

    count = 0
    total_amount = Decimal("0")
    failure_count = 0

    for ev in events:
        ts = ev["timestamp"]
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if cutoff <= ts <= now:
            count += 1
            total_amount += Decimal(str(ev["amount"]))
            if ev.get("status") == "FAILED":
                failure_count += 1

    avg = (total_amount / Decimal(count)) if count > 0 else Decimal("0")
    return {
        "count": count,
        "total_amount": round_money(total_amount, currency),
        "average_amount": round_money(avg, currency),
        "failure_count": failure_count,
    }
