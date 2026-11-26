# FinCore — Data Model & PostgreSQL Invariants

> **Database Engine:** PostgreSQL (`16-alpine` in Docker Compose; verified locally on PostgreSQL `18.7`)
> **Query & Migration Layer:** Knex SQL-first (`apps/api/src/infrastructure/database/migrations/001`–`005`)
> **Monetary Type:** `BIGINT` integer minor units (paise for `INR`; `100` paise = `₹1.00`) — zero binary floating point (`ASSUMPTIONS.md` A1).

---

## 1. Migrations Overview (`001`–`005`)

| Migration | Responsibility | Key Constraints, Triggers & Indexes |
|---|---|---|
| `001_identity_and_audit.ts` | `users`, `roles`, `user_roles`, `sessions`, `refresh_tokens`, `mfa_challenges`, `audit_events` | `UNIQUE(email)`, hashed token family tracking (`family_id`, `generation`, `is_used`), append-only trigger `enforce_audit_immutability` on `audit_events` |
| `002_financial_core.ts` | `customer_profiles`, `wallets`, `beneficiaries`, `journal_transactions`, `ledger_entries`, `wallet_holds`, `transfers` | Positive `amount_minor` checks, `wallets_customer_no_overdraft_check` (`CUSTOMER` wallets cannot go `< 0`), `enforce_ledger_immutability` (`BEFORE UPDATE/DELETE`), `enforce_posted_journal_immutability`, `enforce_journal_balance` (`DEFERRABLE INITIALLY DEFERRED` checking `>=2` entries, single currency, `debit_sum == credit_sum`), `idx_wallets_balance` & transfer indexes |
| `003_payments_disputes_risk.ts` | `payment_intents`, `provider_events`, `refunds`, `disputes`, `dispute_events`, `reconciliation_runs`, `reconciliation_exceptions`, `risk_assessments`, `risk_alerts`, `statements`, `idempotency_records`, `outbox_events`, `notification_jobs` | `UNIQUE(provider_name, provider_event_id)` atomic webhook inbox deduplication, `UNIQUE(actor_id, idempotency_key)` idempotency table, status/currency check constraints |
| `004_system_accounts_and_hardening.ts` | Deterministic synthetic system actor + `SYSTEM_CLEARING`, `SYSTEM_FEE`, and `SYSTEM_SUSPENSE` system control wallets (`wallet_type = 'SYSTEM'`) | Allows double-entry debit/credit parity for external settlement credits (`SYSTEM_CLEARING -> CUSTOMER`) and fee/suspense accounting without allowing negative customer balances |
| `005_security_and_ledger_hardening.ts` | Ledger & dispute immutability hardening plus outbox delivery idempotency | `enforce_ledger_entry_not_posted` (prevents late `INSERT` into an already `POSTED` journal), `enforce_dispute_event_immutability` (append-only `dispute_events`), `idx_notification_jobs_outbox_channel_unique` (`UNIQUE(outbox_event_id, channel)`) |

---

## 2. Core Financial Invariants

1. **Zero Unbalanced Journals:** Every `POSTED` journal must contain at least 2 `ledger_entries` in a single currency with `SUM(CASE WHEN direction='DEBIT' THEN amount_minor ELSE 0 END) == SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE 0 END)`. Enforced in `ledgerService` **and** PostgreSQL deferred constraint trigger `enforce_journal_balance`.
2. **Append-Only Accounting & Audit Logs:** Historical `ledger_entries`, `POSTED` `journal_transactions`, `dispute_events`, and `audit_events` reject `UPDATE` and `DELETE` via PostgreSQL triggers; late additions to a `POSTED` journal also raise a PostgreSQL exception (`enforce_ledger_entry_not_posted`). Corrections occur solely through compensating journals (`REFUND`, `REVERSAL`).
3. **Deterministic Concurrency Locking:** Transfers, holds, refunds, and reversals sort involved `wallet` UUIDs ascending before acquiring `SELECT ... FOR UPDATE`, eliminating AB-BA deadlocks under concurrent load.
4. **Transactional Projection Parity:** `wallets.ledger_balance_minor` and `wallets.available_balance_minor` update inside the same transaction as `ledger_entries` and `wallet_holds`, verifiable anytime via `GET /api/v1/ledger/reconcile/:walletId` and `GET /api/v1/ledger/invariant-check`.
5. **Advisory + Unique Idempotency:** Concurrent identical requests sharing `(userId, Idempotency-Key)` serialize via `pg_advisory_xact_lock` plus canonical SHA-256 request body hashing.

---

## 3. Data Ownership Boundary

- **PostgreSQL (`Express API`):** Sole owner of users, sessions, customer profiles, wallets, beneficiaries, journals, ledger entries, holds, transfers, payment intents, provider events, refunds, disputes, reconciliation runs/exceptions, risk assessments/alerts, statements, idempotency records, outbox events, notification jobs, and audit events.
- **FastAPI Risk Service:** Stateless compute/analytics boundary (`X-Service-Token`). Receives minimized synthetic/pseudonymous numeric payloads and returns typed `Decimal` calculations or risk scores without holding database write credentials to ledger or PII tables.
