# Assessment 06 — FastAPI Risk Analytics Service

## 1. Objective & Scope
Implement an independently deployable FastAPI + Pydantic risk analytics service receiving minimized synthetic transaction payloads, evaluating configurable risk & velocity rules (`RULE_001`–`RULE_007`), returning typed decision-support explanations, and cleanly separating analytical metadata from the Express system of record.

## 2. Implemented Components & Code Paths
- FastAPI App, Config & Security: `backend/risk/app/main.py`, `core/config.py`, `core/security.py` (`X-Service-Token` verified via `hmac.compare_digest`), `X-Request-ID` propagation middleware
- Schemas & Rule Engine: `backend/risk/app/schemas/risk.py`, `domain/rules.py`, `backend/risk_service.py`, `api/risk_router.py`
- Express Proxy & Persistence: `backend/api/src/modules/risk/risk.service.ts`, `risk.routes.ts` (3,000 ms `AbortController` timeout, `FAIL_OPEN` vs `FAIL_CLOSED` honoring upstream non-2xx error behavior, persists `risk_assessments` and `HIGH`/`CRITICAL` `risk_alerts` atomically with audit trail)

## 3. Design Decisions
- FastAPI holds **no financial DB access** and never posts ledger entries or rejects real accounts autonomously (`SIMULATED — decision support only, NOT proof of fraud`).
- Express applies documented `ASSUMPTIONS.md` A10 fallback policy: `FAIL_OPEN` (score 0, `warning` metadata) on transfer assessments if FastAPI times out or returns upstream error; `FAIL_CLOSED` returns `502 RISK_SERVICE_ERROR` / `503 RISK_SERVICE_UNAVAILABLE`.

## 4. Test Commands & Actual Results
- `cd backend/risk && python -m pytest -v --cov=app --cov-report=term-missing`: **23/23 tests passed (99% coverage)** including `/health/live`, `/health/ready`, `401` missing/invalid auth rejection, async `httpx.AsyncClient` integration test, `ValueError -> 400` handler, `RULE_001`–`RULE_007`, negative amount rejection (`422`), `X-Request-ID` echo, and rule catalogue sanitization.
- Express integration test (`backend/api/tests/integration/hardening.test.ts`): verified live Risk proxy `POST /api/v1/risk/assess` persistence, alert generation & resolution, and `FAIL_OPEN` non-blocking behavior.

## 5. Evidence References
- `backend/risk/app/tests/test_api.py`
- `backend/risk/app/tests/test_risk_rules.py`
- `backend/api/tests/integration/hardening.test.ts`
- `frontend/src/app/(operations)/risk-alerts/page.tsx`

## 6. Known Limitations & Remaining Work
- Rule thresholds and weights are configured statically in `backend/risk/app/domain/rules.py` rather than dynamically editable at runtime via UI (`SIMULATED — decision support only`).
