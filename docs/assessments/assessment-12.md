# Assessment 12 — Ledger & Payment Testing

## 1. Objective & Scope
Verify financial correctness, concurrency safety, error/failure paths, security authorization, frontend rendering, and Python Decimal calculations across unit, integration, concurrency, component, and API security suites.

## 2. Implemented Components & Code Paths
- API Unit Suites (`apps/api/tests/unit/`): `money.test.ts` (4), `state-machine.test.ts` (4), `validation.test.ts` (4), `webhook-signature.test.ts` (4)
- API Integration, Concurrency & Security Suites (`apps/api/tests/integration/`, `security/`): `setup.ts`, `env.ts`, `ledger.test.ts` (5), `transfers.test.ts` (2), `concurrency.test.ts` (3), `webhooks-refunds.test.ts` (3), `hardening.test.ts` (4), `capstone-incident.test.ts` (1), `authorization.test.ts` (4)
- Frontend Component Tests (`apps/web/tests/components/ui.test.tsx`) (6) & Playwright E2E Spec (`apps/web/tests/e2e/fincore.spec.ts`) (2)
- Python Pytest Suite (`services/risk/app/tests/`): `test_calculations.py`, `test_risk_rules.py`, `test_api.py` (23 total)

## 3. Design Decisions
- Integration tests run sequentially at the file level (`fileParallelism: false` in `apps/api/vitest.config.ts`) against an isolated PostgreSQL 18 test DB (`fincore_test`) while exercising high concurrency *within* tests via `Promise.all`.
- Deterministic synthetic seed fixtures (`apps/api/tests/integration/setup.ts`) reset transactional tables cleanly between test cases while preserving system clearing accounts and testing DB constraint triggers untouched.

## 4. Test Commands & Actual Results
- **Express API (`pnpm --filter @fincore/api run test:coverage`):** **11/11 files passed, 38/38 tests passed** in `90.87s` against PostgreSQL 18.7; overall coverage `62.29%` (`app.ts` 94.31%, `ledger.service.ts` 86.03%, `refunds.service.ts` 85.57%, `statements.service.ts` 88.81%, `transfers.service.ts` 75.74%, `webhooks.service.ts` 72.77%, `notifications.service.ts` 82.81%, `state-machine.ts` 100%, `idempotency.ts` 100%, `sandbox-provider.ts` 95.65%).
- **Python Risk Service (`cd services/risk && python -m pytest -v --cov=app`):** **23/23 tests passed**; **99% total coverage**.
- **Next.js Frontend (`pnpm --filter @fincore/web run test`):** **6/6 component tests passed** (`7.71s`) + **Playwright E2E (`2/2 passed` in `6.4s`)**.

## 5. Evidence References
- `apps/api/tests/**`, `apps/web/tests/**`, `services/risk/app/tests/**`, `docs/evidence/*.png`

## 6. Known Limitations & Remaining Work
- Automated OpenAPI schema-validation contract test (`tests/contract/`) comparing runtime Supertest payloads automatically against `docs/openapi.yaml` is not yet automated and can be added using `openapi-response-validator`.
