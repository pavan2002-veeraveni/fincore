# CODEBASE.md — FinCore Repository Blueprint

## 1. Purpose

This document defines the intended repository organization and engineering conventions for FinCore, a simulated digital wallet, ledger and payment-processing platform. The FinCore handbook is the acceptance-criteria source of truth.

**Safety boundary:** educational simulation only. Use synthetic data and provider sandboxes. No real funds, banking credentials, identity documents or regulated production claims.

## 2. Architecture at a glance

- `frontend`: Next.js App Router frontend.
- `backend/api`: Express + TypeScript authoritative business API (plus outbox `worker.ts`).
- `backend/risk`: Independently deployable FastAPI risk analytics service.
- `packages/contracts`: shared TypeScript contracts and API schemas.
- `packages/config`: shared lint, formatting and TypeScript configuration.
- PostgreSQL: authoritative system of record.
- Redis: cache and BullMQ broker.
- `infra`: Docker, Compose, reverse proxy, deployment and operational scripts.
- `docs`: architecture, ERD, API, assessments, evidence and runbooks.

The API owns authoritative financial records. The risk service does not post ledger entries.

## 3. Proposed directory tree

```text
fincore/
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── app/
│   │   │   ├── (public)/login/
│   │   │   ├── (public)/register/
│   │   │   ├── (customer)/dashboard/
│   │   │   ├── (customer)/profile/
│   │   │   ├── (customer)/wallets/
│   │   │   ├── (customer)/beneficiaries/
│   │   │   ├── (customer)/transfers/
│   │   │   ├── (customer)/payments/
│   │   │   ├── (customer)/statements/
│   │   │   ├── (customer)/disputes/
│   │   │   ├── (operations)/operations/
│   │   │   ├── (operations)/reconciliation/
│   │   │   ├── (operations)/risk-alerts/
│   │   │   ├── (operations)/admin/
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   ├── lib/
│   │   └── styles/
│   ├── tests/
│   ├── next.config.mjs
│   └── package.json
├── backend/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── worker.ts
│   │   │   ├── config/
│   │   │   ├── middleware/
│   │   │   │   ├── auth.middleware.ts
│   │   │   │   ├── authorize.middleware.ts
│   │   │   │   ├── error.middleware.ts
│   │   │   │   ├── request-id.middleware.ts
│   │   │   │   ├── rate-limit.middleware.ts
│   │   │   │   └── validate.middleware.ts
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── customers/
│   │   │   │   ├── wallets/
│   │   │   │   ├── beneficiaries/
│   │   │   │   ├── ledger/
│   │   │   │   ├── transfers/
│   │   │   │   ├── payments/
│   │   │   │   ├── webhooks/
│   │   │   │   ├── refunds/
│   │   │   │   ├── disputes/
│   │   │   │   ├── reconciliation/
│   │   │   │   ├── risk/
│   │   │   │   ├── statements/
│   │   │   │   ├── notifications/
│   │   │   │   ├── audit/
│   │   │   │   └── admin/
│   │   │   ├── infrastructure/
│   │   │   │   ├── database/
│   │   │   │   ├── queue/
│   │   │   │   ├── providers/
│   │   │   │   ├── logger/
│   │   │   │   └── telemetry/
│   │   │   ├── shared/
│   │   │   │   ├── errors/
│   │   │   │   ├── money/
│   │   │   │   ├── pagination/
│   │   │   │   ├── security/
│   │   │   │   └── types/
│   │   │   └── routes/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   └── security/
│   │   └── package.json
│   └── risk/
│       ├── app/
│       │   ├── main.py
│       │   ├── api/
│       │   ├── core/
│       │   ├── schemas/
│       │   ├── domain/
│       │   ├── services/
│       │   └── tests/
│       ├── pyproject.toml
│       ├── requirements.txt
│       └── requirements.runtime.txt
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   └── package.json
│   └── config/
├── infra/
│   ├── docker/
│   ├── compose/
│   ├── nginx/
│   ├── scripts/
│   └── monitoring/
├── docs/
│   ├── SYSTEM_DESIGN_ARCHITECTURE.md
│   ├── CODEBASE.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── ASSUMPTIONS.md
│   ├── API_CONTRACTS.md
│   ├── DATA_MODEL.md
│   ├── SECURITY.md
│   ├── OPERATIONS_RUNBOOK.md
│   ├── INCIDENT_RUNBOOK.md
│   ├── EVIDENCE_MATRIX.md
│   └── assessments/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── security.yml
│       └── deploy-staging.yml
├── .env.example
├── .gitignore
├── .editorconfig
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── docker-compose.yml
└── README.md
```

## 4. Module ownership and boundaries

| Module | Owns / controls | Must not do |
|---|---|---|
| Auth | users, credentials, sessions, refresh tokens, MFA simulation, roles | expose credential material |
| Customers | customer profile and profile lifecycle | own ledger balances |
| Wallets | wallet/account metadata, status, currency | independently mutate posted ledger |
| Beneficiaries | beneficiary lifecycle, ownership and verification simulation | bypass step-up policy |
| Ledger | journal transactions, immutable entries, holds, balance projection | update/delete posted entries |
| Transfers | transfer lifecycle, idempotency, orchestration | perform non-atomic debit/credit |
| Payments | payment intents and provider adapter orchestration | trust client-reported provider status |
| Webhooks | signature verification, event inbox/dedupe | process unsigned or duplicate events twice |
| Refunds | refund eligibility and compensating postings | mutate original ledger history |
| Disputes | dispute lifecycle, assignments and event history | silently alter payment history |
| Reconciliation | imports, matching, exceptions and resolution | silently force ledger corrections |
| Risk | API-side risk request/response and alert persistence | treat score as proof of fraud |
| Statements | immutable snapshot/export metadata | leak other customers' transactions |
| Audit | append-only business/security event records | permit ordinary users to edit history |
| FastAPI risk | velocity analytics and risk decision support | become financial system of record |

## 5. Module internal pattern

For each Express module, use a consistent pattern as appropriate:

```text
module-name/
├── module-name.routes.ts       # HTTP route definitions
├── module-name.controller.ts   # HTTP translation only
├── module-name.service.ts      # business use cases
├── module-name.repository.ts   # persistence queries
├── module-name.schema.ts       # Zod request validation
├── module-name.types.ts        # module-local types
└── module-name.test.ts
```

Keep controllers thin. Services enforce domain invariants. Repositories isolate persistence. Do not create layers that merely forward calls without adding value.

## 6. Naming conventions

- TypeScript files: `kebab-case.ts`; React components: `PascalCase.tsx`.
- Types/interfaces: `PascalCase`; functions/variables: `camelCase`; constants: `UPPER_SNAKE_CASE`.
- Database tables/columns: `snake_case`; table names plural unless ORM conventions dictate otherwise.
- REST resources: plural nouns; routes lowercase and kebab-case.
- Enums: stable uppercase values such as `PENDING`, `PROCESSING`, `POSTED`, `FAILED`, `REVERSED`.
- Use explicit names: `availableBalanceMinor`, not `balance2`.

## 7. Money and ledger rules

- Do not use JavaScript `number` or Python `float` for monetary arithmetic.
- Prefer integer minor units for a fixed supported currency set (e.g. INR paise) or PostgreSQL `NUMERIC` + decimal library. Pick one canonical representation.
- Currency is mandatory on every monetary amount and ledger account.
- Never aggregate amounts across currencies without explicit FX conversion records and policy.
- Ledger entries are append-only after posting.
- A journal transaction balances debits and credits by currency.
- Reversals are new linked journal transactions.
- Holds affect available balance but are not posted ledger entries until captured/released according to the chosen accounting model.
- Document whether balances are derived from ledger or maintained as a rebuildable projection. Projection updates must be in the same DB transaction as postings.

## 8. Transaction and concurrency policy

- Use PostgreSQL transactions for all multi-row financial operations.
- Lock all affected wallet/account rows in deterministic order to avoid deadlocks.
- Check available balance only after acquiring locks.
- Use unique constraints for idempotency keys and provider event IDs.
- Store a request hash with idempotency record; same key/different payload is `409 IDEMPOTENCY_KEY_REUSED`.
- Define state machines and allowed transitions in domain code and tests.
- Use transactional outbox for messages/jobs that must follow a committed business transaction.
- Never hold a database transaction open while calling an external provider. Use state machine + outbox/saga-style orchestration.

## 9. API contract conventions

Base path: `/api/v1`.

Success:
```json
{
  "data": {},
  "meta": {
    "requestId": "uuid"
  }
}
```

Paginated:
```json
{
  "data": [],
  "meta": {
    "requestId": "uuid",
    "page": 1,
    "pageSize": 25,
    "total": 0
  }
}
```

Error:
```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "The wallet does not have enough available funds.",
    "details": {},
    "requestId": "uuid"
  }
}
```

- Never expose stack traces, SQL, secrets, provider raw payloads or internal exception messages.
- Use correct HTTP status codes.
- Validate all payloads on the server.
- Include request IDs in logs and responses.
- Restrict sorting/filtering fields to explicit allowlists.
- Use idempotency headers for retry-sensitive POST requests.

## 10. Authentication and authorization

- Password hashing: Argon2id preferred; bcrypt acceptable with documented parameters.
- Refresh tokens: opaque random token, store hash, rotate on refresh, revoke on logout, detect reuse where practical.
- Access token: short-lived; claims limited to identity and authorization context.
- Enforce role permissions and record-level ownership in service/repository logic.
- Customer A must never read or mutate Customer B's wallet, transfer, beneficiary, statement or dispute.
- Step-up reauthentication for high-risk operations.
- Simulated MFA must be labelled as a learning simulation.
- Add tests for IDOR, privilege escalation, expired/revoked sessions and cross-role access.

## 11. Queue and integration conventions

- Queue jobs must be idempotent and retry-safe.
- Configure bounded exponential backoff and maximum attempts.
- Store terminal failures/dead-letter state and provide controlled replay.
- Use provider interfaces/adapters; keep provider-specific code out of domain services.
- Set connection/request timeouts.
- Verify webhook signatures over raw bytes before parsing.
- Deduplicate by `(provider, provider_event_id)`.
- Persist webhook inbox record before acknowledging successful receipt.
- Use transactional outbox for internal events.
- Provide local deterministic sandbox adapters so development does not require paid accounts.

## 12. FastAPI service contract

FastAPI is responsible for bounded analytics such as:
- transaction velocity windows
- unusual amount deviation
- repeated failure patterns
- new beneficiary signals
- risk rule evaluation and operational explanation

It returns a typed response including `assessment_id`, `score`, `risk_level`, `rule_hits`, `explanations`, `ruleset_version`, and `evaluated_at`.

The Express API owns authentication and decides what minimal data can be sent. Protect service-to-service calls with an internal credential or network policy. Configure timeouts and safe fallback behavior. Risk output is advisory, not proof of fraud.

## 13. Frontend conventions

- Use feature-based folders and typed API client functions.
- TanStack Query for server state; local component state for ephemeral UI state.
- Use schema validation for forms; repeat all validation on the API.
- Use semantic HTML, keyboard support, visible focus, accessible labels and responsive breakpoints.
- Include loading, empty, success, validation, permission-denied and server-error states.
- Clearly label all balances and transactions as simulated.
- Do not calculate authoritative balances or permissions in the browser.
- Avoid storing long-lived tokens in localStorage. Prefer secure, HttpOnly cookie sessions with CSRF protection where selected.
- Mask wallet/account identifiers in customer-facing views.

## 14. Testing layout and minimum coverage

API:
- `tests/unit`: domain logic, money, state transitions, validation
- `tests/integration`: PostgreSQL transactions, ledger invariants, idempotency, concurrency, webhook dedupe
- `tests/contract`: OpenAPI/API contract checks

Web:
- component tests with React Testing Library
- E2E tests with Playwright

Risk:
- pytest tests for Decimal calculations, velocity windows, risk rules and schema validation

Required edge cases:
- insufficient funds
- duplicate idempotency key / changed payload
- concurrent transfers from one wallet
- duplicate/replayed webhook
- invalid webhook signature
- provider timeout
- DB rollback
- queue outage/retry
- reversal and partial refund boundaries
- currency mismatch
- rounding boundaries
- failed settlement
- cross-customer IDOR and role escalation

## 15. Environment variables

Maintain `.env.example` with placeholders and descriptions. Validate configuration at process startup. Never commit real values.

Expected groups:
- `NODE_ENV`, `PORT`, `WEB_ORIGIN`
- `DATABASE_URL`
- `REDIS_URL`
- `ACCESS_TOKEN_SECRET` or signing key configuration
- refresh-token hashing/rotation configuration
- `RISK_SERVICE_URL`, `RISK_SERVICE_TOKEN`
- provider sandbox keys and webhook signing secrets
- email/SMS sandbox configuration
- logging and telemetry configuration

Do not reuse development secrets in staging or production-like environments.

## 16. Git and change governance

- Use feature branches and pull requests.
- Protect main branch; require CI checks and review for ledger, money and authorization changes.
- Use Conventional Commits, e.g. `feat(ledger): add balanced journal posting`.
- Require migration review and tests for schema changes.
- Tag releases with semantic versions.
- Demonstrate a hotfix branch, regression test and rollback plan.
- Do not rewrite shared history or force-push protected branches.

## 17. Definition of done

A feature is complete only when:
1. Acceptance criteria are mapped to code.
2. Server-side validation and authorization exist.
3. Success, invalid input, unauthorized/boundary and failure paths are tested.
4. Database constraints and transactions protect data integrity.
5. API/UI documentation is updated.
6. Setup and demonstration steps work.
7. Test commands have actually been run and outcomes recorded.
8. Known limitations and sandbox/mocked integrations are clearly disclosed.
9. No secrets or sensitive data are committed.
10. Evidence is linked in the assessment matrix.

A scaffold, mock UI, passing lint, or unverified claim is not a completed feature.

---

## Actual Implemented Structure vs. Initial Blueprint Notes

Per `docs/ASSUMPTIONS.md`, the implemented codebase adheres to the target architecture while recording explicit resolved choices:
- **Persistence Layer (`backend/api`):** Uses **Knex SQL-first** query builder and migrations (`backend/api/src/infrastructure/database/migrations/001`–`005`) for direct transaction, advisory lock (`pg_advisory_xact_lock`), sorted `SELECT ... FOR UPDATE`, and PostgreSQL trigger control (`ASSUMPTIONS.md` A5).
- **Web App (`frontend`):** Includes Next.js App Router routes across `(public)/{login,register}`, `(customer)/{dashboard,profile,wallets,beneficiaries,transfers,payments,statements,disputes}`, and `(operations)/{operations,risk-alerts,reconciliation,admin}`, calling Express `/api/v1` directly (or via Nginx in Compose) with in-memory JWT + `HttpOnly` refresh/CSRF cookies (`ASSUMPTIONS.md` A15).
- **Risk Service (`backend/risk`):** Independent FastAPI service exposing `/health/live`, `/health/ready`, `/api/v1/assess`, `/api/v1/rules`, and `Decimal` calculation endpoints (`/calculate/{fee,interest,pro-rata,statement-summary,reconciliation}`).
