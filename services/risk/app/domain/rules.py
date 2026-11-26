"""
Risk rule engine — evaluates a transaction against a configurable set of rules.

DISCLAIMER: These rules are SIMULATED and are provided for educational /
decision-support purposes only. A rule hit does NOT constitute proof of fraud.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Callable, List, Optional

from app.core.config import settings
from app.domain.calculations import compute_velocity_window
from app.schemas.risk import RiskAssessmentRequest, RiskLevel, RuleHit

RuleFunc = Callable[[RiskAssessmentRequest, tuple[int, Decimal, int]], Optional[RuleHit]]


def _resolve_metrics(req: RiskAssessmentRequest) -> tuple[int, Decimal, int]:
    """Use rolling window samples once per evaluation, falling back to aggregate counts."""
    if req.recent_events is not None:
        win = compute_velocity_window(
            [e.model_dump() for e in req.recent_events],
            req.velocity_window_minutes,
            reference_time=datetime.now(timezone.utc),
            currency=req.currency,
        )
        return (
            max(req.recent_transaction_count, int(win["count"])),
            max(req.recent_total_amount, Decimal(win["total_amount"])),
            max(req.recent_failure_count, int(win["failure_count"])),
        )
    return req.recent_transaction_count, req.recent_total_amount, req.recent_failure_count


def rule_001_velocity(
    req: RiskAssessmentRequest, metrics: tuple[int, Decimal, int]
) -> Optional[RuleHit]:
    """RULE_001 — Velocity check over rolling window."""
    tx_count, _, _ = metrics
    if tx_count > settings.VELOCITY_MAX_TX_COUNT:
        return RuleHit(
            rule_id="RULE_001",
            rule_name="Velocity check",
            severity="MEDIUM",
            explanation=(
                f"Customer executed {tx_count} transactions "
                f"in the {req.velocity_window_minutes}m monitoring window "
                f"(threshold: {settings.VELOCITY_MAX_TX_COUNT})."
            ),
        )
    return None


def rule_002_high_amount(
    req: RiskAssessmentRequest, _metrics: tuple[int, Decimal, int]
) -> Optional[RuleHit]:
    """RULE_002 — High single-transaction amount."""
    threshold = settings.HIGH_AMOUNT_THRESHOLD
    if req.transaction_amount > threshold:
        return RuleHit(
            rule_id="RULE_002",
            rule_name="High amount",
            severity="HIGH",
            explanation=(
                f"Transaction amount {req.transaction_amount} {req.currency} "
                f"exceeds threshold of {threshold}."
            ),
        )
    return None


def rule_003_new_beneficiary_high_amount(
    req: RiskAssessmentRequest, _metrics: tuple[int, Decimal, int]
) -> Optional[RuleHit]:
    """RULE_003 — New beneficiary combined with high amount."""
    threshold = settings.NEW_BENEFICIARY_AMOUNT_THRESHOLD
    if req.beneficiary_is_new and req.transaction_amount > threshold:
        return RuleHit(
            rule_id="RULE_003",
            rule_name="New beneficiary + high amount",
            severity="HIGH",
            explanation=(
                f"First-time beneficiary receiving {req.transaction_amount} "
                f"{req.currency} (threshold: {threshold})."
            ),
        )
    return None


def rule_004_repeated_failures(
    req: RiskAssessmentRequest, metrics: tuple[int, Decimal, int]
) -> Optional[RuleHit]:
    """RULE_004 — Repeated transaction failures."""
    _, _, fail_count = metrics
    if fail_count > settings.REPEATED_FAILURE_THRESHOLD:
        return RuleHit(
            rule_id="RULE_004",
            rule_name="Repeated failures",
            severity="MEDIUM",
            explanation=(
                f"Customer had {fail_count} failed transactions "
                f"in the recent window (threshold: {settings.REPEATED_FAILURE_THRESHOLD})."
            ),
        )
    return None


def rule_005_young_account_high_value(
    req: RiskAssessmentRequest, _metrics: tuple[int, Decimal, int]
) -> Optional[RuleHit]:
    """RULE_005 — Young account with high-value transaction."""
    if (
        req.customer_account_age_days < settings.YOUNG_ACCOUNT_MAX_DAYS
        and req.transaction_amount > settings.YOUNG_ACCOUNT_AMOUNT_THRESHOLD
    ):
        return RuleHit(
            rule_id="RULE_005",
            rule_name="Young account + high value",
            severity="CRITICAL",
            explanation=(
                f"Account age {req.customer_account_age_days} days "
                f"(< {settings.YOUNG_ACCOUNT_MAX_DAYS}) with transaction of "
                f"{req.transaction_amount} {req.currency} "
                f"(threshold: {settings.YOUNG_ACCOUNT_AMOUNT_THRESHOLD})."
            ),
        )
    return None


def rule_006_amount_deviation(
    req: RiskAssessmentRequest, metrics: tuple[int, Decimal, int]
) -> Optional[RuleHit]:
    """RULE_006 — Unusual amount deviation compared with customer baseline average."""
    tx_count, total_amt, _ = metrics
    if tx_count >= 3 and total_amt > 0:
        baseline_avg = total_amt / Decimal(tx_count)
        multiplier = settings.AMOUNT_DEVIATION_MULTIPLIER
        if req.transaction_amount > (baseline_avg * multiplier):
            return RuleHit(
                rule_id="RULE_006",
                rule_name="Unusual amount deviation",
                severity="HIGH",
                explanation=(
                    f"Transaction {req.transaction_amount} {req.currency} exceeds "
                    f"{multiplier}x baseline average ({baseline_avg:.2f} {req.currency})."
                ),
            )
    return None


def rule_007_rapid_beneficiary_changes(
    req: RiskAssessmentRequest, _metrics: tuple[int, Decimal, int]
) -> Optional[RuleHit]:
    """RULE_007 — Rapid beneficiary additions or modifications."""
    if req.recent_beneficiary_changes > settings.RAPID_BENEFICIARY_CHANGE_THRESHOLD:
        return RuleHit(
            rule_id="RULE_007",
            rule_name="Rapid beneficiary changes",
            severity="MEDIUM",
            explanation=(
                f"{req.recent_beneficiary_changes} recent beneficiary changes exceed "
                f"threshold ({settings.RAPID_BENEFICIARY_CHANGE_THRESHOLD})."
            ),
        )
    return None


ALL_RULES: List[dict] = [
    {
        "rule_id": "RULE_001",
        "rule_name": "Velocity check",
        "description": "Flags > 10 transactions in rolling window",
        "severity": "MEDIUM",
        "func": rule_001_velocity,
    },
    {
        "rule_id": "RULE_002",
        "rule_name": "High amount",
        "description": "Flags single transaction > 50 000 units",
        "severity": "HIGH",
        "func": rule_002_high_amount,
    },
    {
        "rule_id": "RULE_003",
        "rule_name": "New beneficiary + high amount",
        "description": "Flags first-time beneficiary + amount > 10 000 units",
        "severity": "HIGH",
        "func": rule_003_new_beneficiary_high_amount,
    },
    {
        "rule_id": "RULE_004",
        "rule_name": "Repeated failures",
        "description": "Flags > 3 recent failed transactions",
        "severity": "MEDIUM",
        "func": rule_004_repeated_failures,
    },
    {
        "rule_id": "RULE_005",
        "rule_name": "Young account + high value",
        "description": "Flags account < 7 days old + amount > 25 000",
        "severity": "CRITICAL",
        "func": rule_005_young_account_high_value,
    },
    {
        "rule_id": "RULE_006",
        "rule_name": "Unusual amount deviation",
        "description": "Flags transaction > 3x historical baseline average",
        "severity": "HIGH",
        "func": rule_006_amount_deviation,
    },
    {
        "rule_id": "RULE_007",
        "rule_name": "Rapid beneficiary changes",
        "description": "Flags > 3 recent beneficiary modifications",
        "severity": "MEDIUM",
        "func": rule_007_rapid_beneficiary_changes,
    },
]

_SEVERITY_WEIGHT: dict[str, int] = {
    "LOW": 5,
    "MEDIUM": 15,
    "HIGH": 25,
    "CRITICAL": 40,
}


def _score_to_level(score: int) -> RiskLevel:
    if score >= 70:
        return RiskLevel.CRITICAL
    if score >= 40:
        return RiskLevel.HIGH
    if score >= 20:
        return RiskLevel.MEDIUM
    return RiskLevel.LOW


def evaluate_rules(
    request: RiskAssessmentRequest,
) -> tuple[List[RuleHit], int, RiskLevel]:
    """Evaluate all configured rules and return (hits, clamped_score_0_100, risk_level)."""
    metrics = _resolve_metrics(request)
    hits: List[RuleHit] = []
    for rule_entry in ALL_RULES:
        result = rule_entry["func"](request, metrics)
        if result is not None:
            hits.append(result)

    raw_score = sum(_SEVERITY_WEIGHT.get(h.severity, 10) for h in hits)
    clamped_score = min(raw_score, 100)
    level = _score_to_level(clamped_score)

    return hits, clamped_score, level
