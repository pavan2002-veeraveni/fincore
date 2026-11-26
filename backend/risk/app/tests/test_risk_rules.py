import time
from decimal import Decimal

from app.domain.calculations import calculate_fee
from app.domain.rules import evaluate_rules
from app.schemas.risk import RiskAssessmentRequest, RiskLevel


def _base_req(**overrides) -> RiskAssessmentRequest:
    data = {
        "customer_id": "cust_synthetic_001",
        "transaction_amount": Decimal("500.00"),
        "currency": "INR",
        "transaction_type": "TRANSFER",
        "beneficiary_is_new": False,
        "recent_beneficiary_changes": 0,
        "recent_transaction_count": 2,
        "recent_total_amount": Decimal("1000.00"),
        "recent_failure_count": 0,
        "customer_account_age_days": 120,
    }
    data.update(overrides)
    return RiskAssessmentRequest(**data)


def test_low_risk_baseline():
    hits, score, level = evaluate_rules(_base_req())
    assert hits == []
    assert score == 0
    assert level == RiskLevel.LOW


def test_velocity_threshold_boundary():
    hits_ok, _, _ = evaluate_rules(_base_req(recent_transaction_count=10, recent_total_amount=Decimal("5000.00")))
    assert all(h.rule_id != "RULE_001" for h in hits_ok)

    hits_hit, score, level = evaluate_rules(_base_req(recent_transaction_count=11, recent_total_amount=Decimal("5500.00")))
    assert any(h.rule_id == "RULE_001" for h in hits_hit)
    assert score == 15
    assert level == RiskLevel.LOW


def test_high_amount_and_new_beneficiary():
    hits, score, level = evaluate_rules(
        _base_req(transaction_amount=Decimal("60000.00"), beneficiary_is_new=True)
    )
    rule_ids = {h.rule_id for h in hits}
    assert {"RULE_002", "RULE_003"}.issubset(rule_ids)
    assert score >= 50
    assert level in (RiskLevel.HIGH, RiskLevel.CRITICAL)


def test_amount_deviation_rule():
    # Baseline average = 3000 / 3 = 1000; 3x = 3000; tx 4500 triggers RULE_006
    hits, score, _ = evaluate_rules(
        _base_req(
            transaction_amount=Decimal("4500.00"),
            recent_transaction_count=3,
            recent_total_amount=Decimal("3000.00"),
        )
    )
    assert any(h.rule_id == "RULE_006" for h in hits)
    assert score >= 25


def test_critical_score_clamped_at_100():
    hits, score, level = evaluate_rules(
        _base_req(
            transaction_amount=Decimal("75000.00"),
            beneficiary_is_new=True,
            recent_beneficiary_changes=5,
            recent_transaction_count=15,
            recent_total_amount=Decimal("15000.00"),
            recent_failure_count=6,
            customer_account_age_days=2,
        )
    )
    assert len(hits) == 7
    assert score == 100
    assert level == RiskLevel.CRITICAL


def test_benchmark_10000_decimal_fee_and_rule_evaluations():
    start = time.perf_counter()
    for _ in range(5000):
        calculate_fee(Decimal("12345.67"), Decimal("0.015"), Decimal("5.00"), Decimal("500.00"), "INR")
    for _ in range(5000):
        evaluate_rules(_base_req(transaction_amount=Decimal("15000.00"), beneficiary_is_new=True))
    elapsed = time.perf_counter() - start
    # Generous CI ceiling confirming sub-3s throughput across 10,000 Decimal evaluations
    assert elapsed < 3.0
