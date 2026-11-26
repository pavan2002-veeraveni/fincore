# FinCore — API Contracts & Integration Guide

> **Base URL (Express API):** `/api/v1` (direct `http://localhost:4000/api/v1` or Nginx reverse proxy `http://localhost/api/v1`)
> **Internal Risk Analytics Service:** `http://localhost:8000` (non-public internal network in Compose, authenticated via `X-Service-Token`)
> **Interactive OpenAPI Specification:** [docs/openapi.yaml](openapi.yaml) | Live endpoint `GET /api/v1/openapi.yaml`
> **Postman Collection (v2.1):** [docs/fincore.postman_collection.json](fincore.postman_collection.json)

---

## 1. Standard Response Envelopes

Every HTTP response sets the `X-Request-ID` correlation header (propagated from Express through PostgreSQL audit events and FastAPI risk calls).

**Success (`2xx`):**
```json
{
  "data": {},
  "meta": {
    "requestId": "uuid-or-header-value",
    "page": 1,
    "pageSize": 20,
    "total": 42
  }
}
```

**Error (`4xx` / `5xx`):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-safe summary without internal stack traces or SQL leaks.",
    "details": {},
    "requestId": "uuid-or-header-value"
  }
}
```

---

## 2. Canonical Error Codes

| HTTP Status | Error Code | Description |
|---:|---|---|
| `400` | `VALIDATION_ERROR` | Zod/Pydantic payload, parameter, UUID, or query failure |
| `400` | `MISSING_RAW_BODY` | Webhook reached controller without raw byte signature verification |
| `400` | `INVALID_WEBHOOK_SIGNATURE` | HMAC-SHA256 mismatch or timestamp outside 5-minute window |
| `401` | `UNAUTHORIZED` | Missing/expired JWT, inactive session, suspended user, or refresh token reuse detected |
| `403` | `FORBIDDEN` | RBAC permission or resource ownership check failed |
| `403` | `STEP_UP_REQUIRED` | Missing or action-mismatched `X-Step-Up-Token` |
| `404` | `NOT_FOUND` | Missing entity or unregistered `/api/v1` path |
| `409` | `CONFLICT` / `IDEMPOTENCY_KEY_REUSED` | Duplicate unique constraint or idempotency key reused with altered payload |
| `422` | `INSUFFICIENT_FUNDS` / `INVALID_STATE_TRANSITION` | Customer available balance exceeded or disallowed workflow transition |
| `429` | `RATE_LIMIT_EXCEEDED` | Auth, sensitive action, or webhook rate threshold hit |
| `502` | `RISK_SERVICE_ERROR` | Upstream FastAPI risk endpoint returned non-2xx on a fail-closed path |
| `503` | `RISK_SERVICE_UNAVAILABLE` | FastAPI risk service timed out (`>3000ms`) or unreachable on fail-closed call |

---

## 3. Idempotency & Step-Up Headers

| Header | Applies To | Behavior |
|---|---|---|
| `Idempotency-Key` | `POST /transfers`, `POST /payment-intents`, `POST /refunds`, `POST /reversals` | Serialized with `pg_advisory_xact_lock` + canonical SHA-256 request fingerprint (`actor + method + path + canonical body`). Replay returns original result (`200`); payload mismatch returns `409 IDEMPOTENCY_KEY_REUSED`. |
| `X-Step-Up-Token` | Transfers create/confirm, beneficiary create/edit/delete, `POST /refunds`, `POST /reversals`, `PATCH /wallets/:id/status`, `PATCH /admin/users/:id/{roles,status}` | Issued by `POST /auth/step-up` or `POST /auth/mfa/verify` (5-minute TTL, bound to `userId`, `sessionId`, and exact action scope). |
| `X-CSRF-Token` | Cookie-authenticated `POST /auth/refresh` | Must match `fincore_csrf` cookie value alongside `HttpOnly` `fincore_refresh`. |
| `X-Webhook-Signature` | `POST /webhooks/sandbox` | Format `t=<unix_sec>,v1=<hmac_sha256_hex>` computed over raw request body bytes. |

---

## 4. Endpoint Summary by Module

- **Health & Contracts:** `GET /health/live`, `GET /health/ready`, `GET /openapi.yaml`, `GET /metrics`
- **Auth & Sessions:** `POST /auth/{register,login,refresh,logout,step-up,mfa/challenge,mfa/verify}`, `GET /auth/me`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`
- **Customers:** `GET /customers/me`, `PATCH /customers/me`, `GET /customers`, `GET /customers/:id`
- **Wallets & Ledger:** `POST /wallets`, `GET /wallets`, `GET /wallets/:id`, `GET /wallets/:id/balance`, `GET /wallets/:id/transactions`, `PATCH /wallets/:id/status`, `GET /ledger/{invariant-check,journals/:id,reconcile/:walletId}`
- **Beneficiaries:** `POST /beneficiaries`, `GET /beneficiaries`, `PATCH /beneficiaries/:id`, `DELETE /beneficiaries/:id`
- **Transfers:** `POST /transfers`, `POST /transfers/:id/confirm`, `POST /transfers/:id/cancel`, `GET /transfers`, `GET /transfers/:id`
- **Payments & Webhooks:** `POST /payment-intents`, `GET /payment-intents`, `GET /payment-intents/:id`, `POST /payment-intents/:id/simulate-webhook`, `POST /webhooks/:provider`
- **Refunds & Reversals:** `POST /refunds`, `GET /refunds`, `GET /refunds/:id`, `POST /reversals`
- **Disputes:** `POST /disputes`, `GET /disputes`, `GET /disputes/:id`, `POST /disputes/:id/events`
- **Statements:** `POST /statements`, `GET /statements`, `GET /statements/:id/export`
- **Reconciliation & Risk:** `POST /reconciliation/runs`, `GET /reconciliation/runs`, `GET /reconciliation/runs/:id`, `GET /reconciliation/exceptions`, `PATCH /reconciliation/exceptions/:id/resolve`, `GET /risk/alerts`, `PATCH /risk/alerts/:id`, `GET /risk/assessments/:id`, `POST /risk/assess`
- **Operations & Admin:** `GET /operations/dashboard`, `GET /admin/{audit-events,users,config,outbox/failed}`, `PATCH /admin/users/:id/{roles,status}`, `POST /admin/outbox/:id/replay`

---

## 5. FastAPI Risk Analytics & Financial Calculations (`backend/risk`)

Authenticated with `X-Service-Token` (`hmac.compare_digest`):
- `GET /health/live`, `GET /health/ready`
- `POST /api/v1/assess` — Evaluates `RULE_001`–`RULE_007`, returns numeric score (`0`–`100`), band (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), matched rules, and disclaimer.
- `GET /api/v1/rules` — Lists configured rules & weights.
- `POST /api/v1/calculate/fee`, `POST /api/v1/calculate/interest`, `POST /api/v1/calculate/pro-rata`, `POST /api/v1/calculate/statement-summary`, `POST /api/v1/calculate/reconciliation` — Exact Python `Decimal` / `BigInt`-safe minor-unit arithmetic (`INR` uses `ROUND_HALF_EVEN`).
