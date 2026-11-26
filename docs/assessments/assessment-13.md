# Assessment 13 — Financial API Contracts

## 1. Objective & Scope
Publish accurate OpenAPI 3.1 contracts, Postman test collection, standardized envelopes, error codes, idempotency semantics, webhook HMAC documentation, and lifecycle architecture docs aligned cleanly with implemented Express routes.

## 2. Implemented Components & Code Paths
- OpenAPI 3.1 Spec: `docs/openapi.yaml`
- Postman Collection v2.1: `docs/fincore.postman_collection.json`
- API Reference Guide: `docs/API_CONTRACTS.md`
- Architecture & Data Model Docs: `SYSTEM_DESIGN_ARCHITECTURE.md`, `CODEBASE.md`, `docs/DATA_MODEL.md`, `docs/ASSUMPTIONS.md`, `README.md`

## 3. Design Decisions
- Checked-in `docs/openapi.yaml` (OpenAPI 3.1.0, `59` paths, served live at `GET /api/v1/openapi.yaml` HTTP `200`) mirrors every `/api/v1` route group mounted in `apps/api/src/app.ts`, including `Idempotency-Key`, `X-Step-Up-Token`, `X-CSRF-Token`, and `X-Webhook-Signature` parameters plus shared `ErrorEnvelope` schemas.
- `docs/fincore.postman_collection.json` organizes requests across 7 domain folders with dynamic test assertions and environment placeholders (zero secrets).
- `docs/API_CONTRACTS.md` documents pagination (`meta.page`, `meta.pageSize`, `meta.total`), all canonical error codes (`VALIDATION_ERROR`, `STEP_UP_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `INSUFFICIENT_FUNDS`, `RATE_LIMIT_EXCEEDED`, `RISK_SERVICE_ERROR`, `RISK_SERVICE_UNAVAILABLE`, `MISSING_RAW_BODY`), and FastAPI calculation routes.

## 4. Test Commands & Actual Results
- Validated `docs/openapi.yaml` (`59` paths) with Python `PyYAML` and `docs/fincore.postman_collection.json` (`7` folders) with JSON parser cleanly; verified live `GET /api/v1/openapi.yaml` returned HTTP `200`.
- Supertest integration requests across 38 API tests verified live JSON envelopes, `X-Request-ID` correlation, and status codes (`200`, `201`, `400`, `401`, `403`, `404`, `409`, `422`, `502`).

## 5. Evidence References
- `docs/openapi.yaml`, `docs/fincore.postman_collection.json`, `docs/API_CONTRACTS.md`

## 6. Known Limitations & Remaining Work
- Automated OpenAPI schema-validation contract test (`tests/contract/`) comparing runtime Supertest payloads automatically against `docs/openapi.yaml` is not yet automated and can be added using `openapi-response-validator`.
