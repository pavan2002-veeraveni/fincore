# Assessment 04 — Financial Identity & Authorization

## 1. Objective & Scope
Enforce robust authentication, rotating revocable sessions with token-reuse detection, step-up reauthentication / simulated MFA, RBAC across 5 roles, resource-level IDOR isolation, and append-only security audit logging.

## 2. Implemented Components & Code Paths
- Auth Service, Repository, Controller, Schemas, Routes: `apps/api/src/modules/auth/*`
- Middleware: `apps/api/src/middleware/auth.middleware.ts`, `authorize.middleware.ts`, `step-up.middleware.ts`, `rate-limit.middleware.ts`
- Admin Role & Session Revocation: `apps/api/src/modules/admin/admin.routes.ts`

## 3. Design Decisions
- Passwords hashed with `bcrypt` cost factor `12`. Refresh tokens are 64-byte CSPRNG tokens stored keyed with `HMAC-SHA256` (`REFRESH_TOKEN_SECRET`) and `family_id` + `generation`.
- When token reuse (`is_used === true`) is detected in `auth.service.ts`, the service commits family revocation, session termination, and `REFRESH_TOKEN_REUSE_DETECTED` audit event *before* throwing `401 Unauthorized` (fixed after integration test caught rollback-on-throw bug).
- `authenticate` validates live session `is_active` and user `ACTIVE` status in PostgreSQL on each request; `logout` enforces caller session ownership, and cookie `Secure` flag honors `COOKIE_SECURE` (`true` by default in production).
- Simulated MFA uses `crypto.randomInt`, locks the challenge row with `FOR UPDATE` inside a transaction, caps attempts at `5`, and explicitly discloses `SIMULATED MFA — NOT FOR PRODUCTION`.
- `PATCH /admin/users/:id/roles` and `/status` are strictly locked to `PLATFORM_ADMIN` with self/SYSTEM-account mutation blocked, and `PATCH /wallets/:id/status` requires `WALLET_STATUS_CHANGE` step-up.

## 4. Test Commands & Actual Results
- `apps/api/tests/security/authorization.test.ts` (**4/4 tests passed**) + `apps/api/tests/integration/hardening.test.ts` (**4/4 tests passed**): verified cross-customer IDOR rejection (including sender transfer-refund IDOR fix), RBAC escalation blocking (`FINANCE_ADMIN` blocked from role/status mutations), wrong step-up scope rejection (`403`), MFA verification & 5-attempt lockout, logout ownership, cookie+CSRF refresh, refresh token reuse detection + family/session revocation (`401`), session invalidation on suspension, and CSV formula-injection neutralization (`'=CMD`).

## 5. Evidence References
- Security Documentation: `docs/SECURITY.md`
- Security Test Suite: `apps/api/tests/security/authorization.test.ts`

## 6. Known Limitations & Remaining Work
- Rate limiter (`express-rate-limit`) skips in `NODE_ENV=test` unless `ENABLE_RATE_LIMIT_IN_TEST=true`; production should place Redis store behind `express-rate-limit` for multi-instance limits.
