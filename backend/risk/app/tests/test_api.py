import asyncio
from datetime import datetime, timezone
import httpx
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)
VALID_HEADERS = {"X-Service-Token": settings.effective_service_token}


def test_health_endpoints():
    live = client.get("/health/live")
    assert live.status_code == 200
    assert live.json()["status"] == "alive"

    ready = client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert "X-Request-ID" in ready.headers


def test_assess_requires_valid_service_token():
    resp = client.post(
        "/api/v1/assess",
        json={
            "customer_id": "cust_1",
            "transaction_amount": "500.00",
            "currency": "INR",
            "transaction_type": "TRANSFER",
        },
    )
    assert resp.status_code == 401

    bad = client.post(
        "/api/v1/assess",
        headers={"X-Service-Token": "wrong-token"},
        json={
            "customer_id": "cust_1",
            "transaction_amount": "500.00",
            "currency": "INR",
            "transaction_type": "TRANSFER",
        },
    )
    assert bad.status_code == 401


def test_assess_endpoint_returns_decision_support_response():
    resp = client.post(
        "/api/v1/assess",
        headers={**VALID_HEADERS, "X-Request-ID": "11111111-1111-4111-8111-111111111111"},
        json={
            "customer_id": "cust_synthetic_99",
            "transaction_amount": "60000.00",
            "currency": "INR",
            "transaction_type": "TRANSFER",
            "beneficiary_is_new": True,
            "recent_transaction_count": 12,
            "recent_total_amount": "12000.00",
            "recent_failure_count": 4,
            "customer_account_age_days": 3,
        },
    )
    assert resp.status_code == 200
    assert resp.headers["X-Request-ID"] == "11111111-1111-4111-8111-111111111111"
    body = resp.json()
    assert body["score"] == 100
    assert body["risk_level"] == "CRITICAL"
    assert len(body["rule_hits"]) >= 5
    assert any("decision support only" in exp for exp in body["explanations"])


def test_calculate_fee_and_interest_endpoints():
    fee_resp = client.post(
        "/api/v1/calculate/fee",
        headers=VALID_HEADERS,
        json={"amount": "1000.00", "rate": "0.025", "currency": "INR"},
    )
    assert fee_resp.status_code == 200
    assert fee_resp.json()["fee"] == "25.00"

    int_resp = client.post(
        "/api/v1/calculate/interest",
        headers=VALID_HEADERS,
        json={"principal": "100000.00", "annual_rate": "0.05", "days": 365, "currency": "INR"},
    )
    assert int_resp.status_code == 200
    assert int_resp.json()["interest"] == "5000.00"


def test_invalid_negative_amount_returns_422():
    resp = client.post(
        "/api/v1/assess",
        headers=VALID_HEADERS,
        json={
            "customer_id": "cust_1",
            "transaction_amount": "-10.00",
            "currency": "INR",
            "transaction_type": "TRANSFER",
        },
    )
    assert resp.status_code == 422


def test_list_rules_strips_callables():
    resp = client.get("/api/v1/rules", headers=VALID_HEADERS)
    assert resp.status_code == 200
    rules = resp.json()
    assert len(rules) == 7
    assert all("func" not in r for r in rules)


def test_pro_rata_statement_summary_reconciliation_and_domain_value_error_400():
    pr = client.post(
        "/api/v1/calculate/pro-rata",
        headers=VALID_HEADERS,
        json={"total_minor": 10000, "weights": [1, 1, 1]},
    )
    assert pr.status_code == 200
    assert pr.json()["allocations"] == [3334, 3333, 3333]

    ss = client.post(
        "/api/v1/calculate/statement-summary",
        headers=VALID_HEADERS,
        json={
            "entries": [
                {"amount": "1500.00", "currency": "INR"},
                {"amount": "-499.50", "currency": "INR"},
            ]
        },
    )
    assert ss.status_code == 200
    assert ss.json()["net"] == "1000.50"

    rc = client.post(
        "/api/v1/calculate/reconciliation",
        headers=VALID_HEADERS,
        json={
            "internal_items": [{"reference": "tx1", "amount": "250.00", "currency": "INR"}],
            "provider_items": [{"reference": "tx1", "amount": "249.00", "currency": "INR"}],
            "default_currency": "INR",
        },
    )
    assert rc.status_code == 200
    assert rc.json()["net_variance"] == "-1.00"
    assert rc.json()["items"][0]["classification"] == "AMOUNT_MISMATCH"

    # Domain ValueError (min_fee > max_fee or unsupported currency) -> safe 400 instead of 500
    bad_bounds = client.post(
        "/api/v1/calculate/fee",
        headers=VALID_HEADERS,
        json={"amount": "100.00", "rate": "0.01", "min_fee": "50.00", "max_fee": "10.00", "currency": "INR"},
    )
    assert bad_bounds.status_code == 400

    bad_cur = client.post(
        "/api/v1/calculate/fee",
        headers=VALID_HEADERS,
        json={"amount": "100.00", "rate": "0.01", "currency": "XYZ"},
    )
    assert bad_cur.status_code == 400


def test_async_httpx_rolling_velocity_assessment():
    async def _run():
        now_iso = datetime.now(timezone.utc).isoformat()
        events = [{"amount": "1000.00", "timestamp": now_iso, "status": "FAILED"} for _ in range(12)]
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://risk.test") as ac:
            return await ac.post(
                "/api/v1/assess",
                headers=VALID_HEADERS,
                json={
                    "customer_id": "cust_async_01",
                    "transaction_amount": "15000.00",
                    "currency": "INR",
                    "transaction_type": "TRANSFER",
                    "beneficiary_is_new": True,
                    "recent_events": events,
                    "velocity_window_minutes": 60,
                },
            )

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    rule_ids = {r["rule_id"] for r in resp.json()["rule_hits"]}
    assert {"RULE_001", "RULE_003", "RULE_004"}.issubset(rule_ids)
