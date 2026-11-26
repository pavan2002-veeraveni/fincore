# FinCore Security Architecture (`SECURITY.md`)

> Educational Simulation Boundary: FinCore enforces defense-in-depth controls as a learning platform. It handles synthetic data only and makes no claim of PCI-DSS, SOC 2, or banking regulatory certification.

## 1. Authentication & Token Storage

- **Password Hashing:** `bcrypt` with cost factor `12` (`BCRYPT_ROUNDS = 12`). Plaintext passwords are never stored or logged.
- **Access Tokens:** Short-lived JWT (`ACCESS_TOKEN_EXPIRY = 15m`), kept strictly **in memory** by the Next.js frontend — never written to `localStorage`.
- **Refresh Tokens & Sessions:** 64-byte cryptographically random opaque tokens stored hashed (`HMAC-SHA256` keyed by `REFRESH_TOKEN_SECRET`) in `refresh_tokens` with `family_id` and `generation` tracking.
  - Every `/auth/refresh` rotates the token and detects reuse (`is_used === true`), immediately revoking the entire token family, terminating the active session, and writing `REFRESH_TOKEN_REUSE_DETECTED` to `audit_events`.
  - Refresh tokens are delivered to browsers via `HttpOnly`, `SameSite=Lax`, and configurable `Secure` cookies (`COOKIE_SECURE`, defaulting to `true` when `NODE_ENV=production`) paired with a double-submit `X-CSRF-Token` validation on cookie-authenticated refreshes.
  - `authenticate` middleware checks the session `is_active` flag and user `ACTIVE` status in PostgreSQL on each request so session revocations (`DELETE /auth/sessions/:id`) and admin suspensions take effect immediately.

## 2. Step-Up Verification & Simulated MFA

- Sensitive endpoints (transfers create/confirm, beneficiary creation/edit/deactivation, refunds, reversals, wallet status freeze/close, admin role/status mutations) enforce `requireStepUp(...)` middleware via short-lived `X-Step-Up-Token` (5m expiry, scoped by action + user + session).
- Step-up tokens can be obtained either by password reauthentication (`POST /auth/step-up`) or by **SIMULATED MFA** (`POST /auth/mfa/challenge` + `POST /auth/mfa/verify`, using `crypto.randomInt`, bounded to 5 attempts, clearly labelled educational simulation).

## 3. Authorization, RBAC & IDOR Defense

- Five roles enforced on routes: `CUSTOMER`, `SUPPORT_AGENT`, `OPERATIONS_ANALYST`, `FINANCE_ADMIN`, `PLATFORM_ADMIN`.
- Every customer-scoped read and write verifies record ownership (`customer_id` derived from authenticated `req.userId`, never trusted from request body/params).

## 4. Webhook, Transport, Injection & Output Safety

- **Webhooks:** Raw request bytes captured before JSON parsing; HMAC-SHA256 verified using `crypto.timingSafeEqual`; 5-minute replay timestamp tolerance; atomic deduplication via `UNIQUE(provider_name, provider_event_id)`.
- **Headers & Limits:** `helmet()`, strict `WEB_ORIGIN` CORS allowlist with `credentials: true`, 1 MB body size cap, `express-rate-limit` on `/auth`, sensitive mutations, and `/webhooks`.
- **SQL & CSV Safety:** Parameterized Knex queries; allowlisted `sortBy`/`sortDir` column mappings; `csv-stringify` quoting plus formula-injection prefix neutralization (`'` prefix on leading `= + - @ \t \r`).
- **Logging & Errors:** Pino redacts passwords, tokens, authorization headers, and cookies; `errorMiddleware` never leaks stack traces or SQL errors in HTTP responses.
- **FastAPI Boundary:** Internal analytics only (`X-Service-Token` verified via `hmac.compare_digest`); risk service holds no DB write access to ledger or customer PII.
