import pytest
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.domain.calculations import (
    allocate_pro_rata,
    calculate_fee,
    calculate_interest,
    calculate_reconciliation_batch,
    calculate_statement_summary,
    compute_velocity_window,
    decimal_to_minor,
    minor_to_decimal,
    round_money,
)


def test_decimal_avoids_binary_float_drift():
    # Classical float failure: 0.1 + 0.2 == 0.30000000000000004
    summary = calculate_statement_summary(
        [
            {"amount": "0.10", "currency": "INR"},
            {"amount": "0.20", "currency": "INR"},
        ]
    )
    assert summary["total_credits"] == Decimal("0.30")
    assert summary["net"] == Decimal("0.30")


def test_inr_bankers_rounding_round_half_even():
    # Halfway ties round to even hundredth for INR
    assert round_money(Decimal("10.005"), "INR") == Decimal("10.00")
    assert round_money(Decimal("10.015"), "INR") == Decimal("10.02")
    assert round_money(Decimal("10.025"), "INR") == Decimal("10.02")
    # Non-INR currencies use ROUND_HALF_UP
    assert round_money(Decimal("10.005"), "USD") == Decimal("10.01")
    assert round_money(Decimal("10.025"), "USD") == Decimal("10.03")


def test_minor_major_conversions_exact():
    assert minor_to_decimal(150075, "INR") == Decimal("1500.75")
    assert decimal_to_minor(Decimal("1500.75"), "INR") == 150075
    assert minor_to_decimal(0, "INR") == Decimal("0.00")
    assert minor_to_decimal(50, "JPY") == Decimal("50")


def test_calculate_fee_clamping_and_validation():
    # Percentage within bounds
    assert calculate_fee(Decimal("1000.00"), Decimal("0.015"), Decimal("5"), Decimal("50"), "INR") == Decimal("15.00")
    # Clamped at floor
    assert calculate_fee(Decimal("100.00"), Decimal("0.015"), Decimal("5"), Decimal("50"), "INR") == Decimal("5.00")
    # Clamped at ceiling
    assert calculate_fee(Decimal("10000.00"), Decimal("0.015"), Decimal("5"), Decimal("50"), "INR") == Decimal("50.00")

    with pytest.raises(ValueError):
        calculate_fee(Decimal("0"), Decimal("0.01"))
    with pytest.raises(ValueError):
        calculate_fee(Decimal("100"), Decimal("-0.01"))
    with pytest.raises(ValueError):
        calculate_fee(Decimal("100"), Decimal("0.01"), Decimal("100"), Decimal("10"))


def test_calculate_interest_boundaries():
    interest = calculate_interest(Decimal("100000.00"), Decimal("0.05"), 365, "INR")
    assert interest == Decimal("5000.00")

    half_year = calculate_interest(Decimal("10000.00"), Decimal("0.06"), 30, "INR")
    assert half_year == Decimal("49.32")

    with pytest.raises(ValueError):
        calculate_interest(Decimal("-100"), Decimal("0.05"), 30)
    with pytest.raises(ValueError):
        calculate_interest(Decimal("100"), Decimal("0.05"), 0)


def test_allocate_pro_rata_preserves_total_without_penny_loss():
    # Splitting ₹100.00 (10000 paise) evenly 3 ways -> 3334 + 3333 + 3333 == 10000
    parts = allocate_pro_rata(10000, [1, 1, 1])
    assert parts == [3334, 3333, 3333]
    assert sum(parts) == 10000

    # Weighted split
    weighted = allocate_pro_rata(101, [1, 2, 3])
    assert sum(weighted) == 101


def test_statement_summary_mixed_currency_rejected():
    with pytest.raises(ValueError):
        calculate_statement_summary(
            [
                {"amount": "100.00", "currency": "INR"},
                {"amount": "50.00", "currency": "USD"},
            ]
        )


def test_compute_velocity_window():
    now = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)
    events = [
        {"amount": "500.00", "timestamp": now - timedelta(minutes=10), "status": "COMPLETED"},
        {"amount": "1500.00", "timestamp": now - timedelta(minutes=30), "status": "FAILED"},
        {"amount": "9999.00", "timestamp": now - timedelta(minutes=120), "status": "COMPLETED"},
    ]
    res = compute_velocity_window(events, window_minutes=60, reference_time=now)
    assert res["count"] == 2
    assert res["total_amount"] == Decimal("2000.00")
    assert res["average_amount"] == Decimal("1000.00")
    assert res["failure_count"] == 1

    # Naive reference/event strings and currency param
    res_jpy = compute_velocity_window(
        [{"amount": "120", "timestamp": "2026-11-26T11:55:00Z"}],
        window_minutes=30,
        reference_time=datetime(2026, 11, 26, 12, 0),
        currency="JPY",
    )
    assert res_jpy["total_amount"] == Decimal("120")

    with pytest.raises(ValueError):
        compute_velocity_window(events, window_minutes=0)


def test_reconciliation_batch_and_boundary_guards():
    res = calculate_reconciliation_batch(
        internal_items=[
            {"reference": "ord_1", "amount": "100.00", "currency": "INR"},
            {"reference": "ord_2", "amount": "200.00", "currency": "INR"},
            {"reference": "ord_3", "amount": "50.00", "currency": "INR"},
        ],
        provider_items=[
            {"reference": "ord_1", "amount": "100.00", "currency": "INR"},
            {"reference": "ord_1", "amount": "100.00", "currency": "INR"},
            {"reference": "ord_2", "amount": "199.50", "currency": "INR"},
            {"reference": "ord_unknown", "amount": "25.00", "currency": "INR"},
        ],
    )
    assert res["matched_count"] == 1
    assert res["exception_count"] == 4
    classifications = {item["classification"] for item in res["items"]}
    assert {"MATCHED", "DUPLICATE", "AMOUNT_MISMATCH", "MISSING_INTERNAL", "MISSING_PROVIDER"}.issubset(classifications)
    assert res["total_internal"] == Decimal("350.00")
    assert res["total_provider"] == Decimal("424.50")
    assert res["net_variance"] == Decimal("74.50")

    # Zero-amount first entry still enforces currency match on subsequent rows
    with pytest.raises(ValueError):
        calculate_statement_summary(
            [
                {"amount": "0.00", "currency": "INR"},
                {"amount": "10.00", "currency": "USD"},
            ]
        )

    # Unsupported currency & invalid pro-rata boundaries
    with pytest.raises(ValueError):
        round_money(Decimal("10.00"), "XYZ")
    with pytest.raises(ValueError):
        allocate_pro_rata(-1, [1])
    with pytest.raises(ValueError):
        allocate_pro_rata(100, [])
    with pytest.raises(ValueError):
        allocate_pro_rata(100, [1, -1])
    with pytest.raises(ValueError):
        allocate_pro_rata(100, [0, 0])
