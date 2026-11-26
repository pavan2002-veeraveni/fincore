# FinCore — Design Assumptions

> Recorded per operating rule #15. Each assumption is numbered for traceability.

## A1 — Monetary Representation
**Decision:** Use integer minor units (paise for INR). All amounts stored as `BIGINT` in PostgreSQL and `number` (safe integer range) in TypeScript. Python uses `Decimal` for calculations, converting to/from integer minor units at service boundaries.
**Rationale:** INR-focused simulation; integer arithmetic eliminates rounding ambiguity for storage and comparisons. NUMERIC(20,4) adds complexity without benefit for a single-currency educational system.
**Reversible:** Yes — migration can convert to NUMERIC if multi-currency with sub-paise precision is needed.

## A2 — Currency Scope
**Decision:** Support INR as the primary currency. Schema includes currency code on every monetary field to allow future extension.
**Reversible:** Yes.

## A3 — Balance Approach
**Decision:** Transactional balance projection. `wallets.available_balance_minor` and `wallets.ledger_balance_minor` are updated in the same DB transaction as ledger postings. A reconciliation query can rebuild balances from ledger entries.
**Rationale:** Performance for reads; projection is always consistent because updates are transactional.

## A4 — Authentication Strategy
**Decision:** Bearer token (JWT access token, opaque refresh token). Access tokens are short-lived (15 min). Refresh tokens are stored as hashed values, rotated on each refresh, with reuse detection.
**Trade-off:** Tokens stored in memory/httpOnly cookies by the frontend. Document XSS considerations. No localStorage for tokens.

## A5 — ORM Choice
**Decision:** Knex.js as query builder with raw SQL for locking and advanced constraints. Not a full ORM.
**Rationale:** Full control over SQL for financial operations (FOR UPDATE, deferred constraints). Prisma's transaction API has limitations for row-level locking patterns. Knex provides typed query building with escape hatches.

## A6 — Worker Architecture
**Decision:** Worker runs as a separate process sharing the API's compiled packages. Uses BullMQ.
**Rationale:** Keeps the API process responsive; worker can be scaled independently.

## A7 — Provider Sandbox
**Decision:** Implement a local sandbox payment provider adapter that simulates Razorpay-like behavior (create order, webhook, settlement). No real provider account required.
**Rationale:** Avoids paid dependencies; fully testable locally.

## A8 — MFA Simulation
**Decision:** MFA challenge generates a 6-digit synthetic code via `crypto.randomInt` (returned in non-production only as `simulatedCode` for automated evaluation), limits verification to 5 attempts, and validates deterministically inside a row-locked transaction. Clearly labelled "SIMULATED MFA — NOT FOR PRODUCTION."

## A9 — Pagination Strategy
**Decision:** Offset-based pagination with `page` and `pageSize` parameters. Maximum page size enforced server-side.
**Rationale:** Simpler for educational demonstration. Cursor-based would be used for high-volume production.

## A10 — Risk Service Timeout Policy
**Decision:** 3-second timeout for risk service calls. Fail-open for transfers (proceed with elevated logging). Fail-closed for sensitive admin operations.
**Documented:** Operations runbook covers manual review when risk service is unavailable.

## A11 — Statement Export
**Decision:** CSV export generated on-demand from ledger entries for a wallet and date range. Generated deterministically on demand in memory bounded by `statement.generated_at` and streamed directly (`text/csv`) with CSV formula-injection neutralization rather than stored on ephemeral local disk.

## A12 — Deletion Policy
**Decision:** Soft-delete for users and customer profiles. Financial records (ledger entries, journal transactions, audit events) are never deleted. Wallets are deactivated, not deleted.

## A13 — System Clearing Control Accounts
**Decision:** Add `wallet_type` (`CUSTOMER`, `SYSTEM_CLEARING`, `SYSTEM_FEE`, `SYSTEM_SUSPENSE`) seeded via migration `004`. `CUSTOMER` wallets strictly enforce `available_balance_minor >= 0`, while internal `SYSTEM_*` control wallets can carry negative contra balances so external payment inflows/refunds maintain strict global zero-sum double-entry (`SUM(debits) === SUM(credits)`).
**Reversible:** Yes — dedicated GL accounts table could separate internal accounts later if multi-currency treasury grows.

## A14 — Step-Up Reauthentication & Scopes
**Decision:** High-risk actions (`TRANSFER`, `BENEFICIARY_CHANGE`, `REFUND`, `REVERSAL`, `ROLE_CHANGE`) require a short-lived signed `X-Step-Up-Token` (5-minute TTL) obtained via password re-entry (`POST /auth/step-up`) or simulated 6-digit MFA (`POST /auth/mfa/verify`).
**Reversible:** Yes — policy middleware can exempt low-value tiers if configured.

## A15 — In-Memory Access Token + HttpOnly Refresh Cookie
**Decision:** Express API emits both JSON tokens (for REST/Postman/tests) and an `HttpOnly`, `SameSite=Lax` refresh cookie (`fincore_refresh`) paired with double-submit `X-CSRF-Token` validation (`fincore_csrf`) on cookie refresh. The Next.js frontend keeps the access token strictly in memory — zero `localStorage` persistence.
**Trade-off:** Hard page refresh triggers a fast silent refresh via `/auth/refresh` using the HttpOnly cookie.

## A16 — Repository Layout (`backend/` and `frontend/`)
**Decision:** All backend services reside under `backend/` (`backend/api/` for the Express API + outbox worker + migrations, and `backend/risk/` for the independently deployable FastAPI analytics service), while the Next.js App Router UI resides under `frontend/`. Shared cross-boundary Zod schemas and money helpers stay in root `packages/` alongside `infra/` and `docs/`.
**Rationale:** Matches explicit repository organization requirements separating backend and frontend code trees cleanly while preserving workspace resolution (`pnpm-workspace.yaml`) and service boundary separation (`ASSUMPTIONS.md` A10).
