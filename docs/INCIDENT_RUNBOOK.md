# FinCore Financial Incident Runbook

## Incident 1 — Duplicate or Replayed Provider Webhook

- **Signals:** Spike in `metrics.counters.webhooksDeduplicated`, repeated `provider_event_id` hits in logs.
- **Expected System Behavior:** PostgreSQL `UNIQUE(provider_name, provider_event_id)` + `ON CONFLICT DO NOTHING` returns `{ status: "duplicate" }` idempotently without re-crediting customer wallet.
- **Operator Check:** Verify `ledger_entries` for `reference_id = <payment_intent_id>` contains only one `PAYMENT` journal.

## Incident 2 — Rejected Unbalanced Journal Attempt

- **Signals:** `ValidationError: Journal does not balance` or PostgreSQL exception `Journal transaction ... does not balance`.
- **Expected System Behavior:** Transaction rolls back atomically; zero partial entries persisted.
- **Operator Action:** Run `GET /api/v1/ledger/invariant-check` to confirm `balanced === true` across all posted journals.

## Incident 3 — Failed Settlement or Amount Mismatch Webhook

- **Signals:** `reconciliation_exceptions` created (`FAILED_SETTLEMENT_CONFLICT`, `AMOUNT_MISMATCH`, or `MISSING_INTERNAL`), webhook status `FAILED` or `failed_recorded`.
- **Expected System Behavior:** Wallet is NEVER falsely credited on `payment.failed` / `settlement.failed`; mismatches halt before posting and open a `reconciliation_exceptions` record.
- **Operator Action:** Inspect exception in `/reconciliation`, verify sandbox provider payload, issue explicit compensating refund/reversal if post-capture conflict occurred, then mark exception `RESOLVED`.

## Incident 4 — Concurrent Transfers / Double-Spend Attempt

- **Signals:** Burst of simultaneous `POST /transfers` hitting `422 INSUFFICIENT_FUNDS`.
- **Expected System Behavior:** Deterministic sorted-ID `SELECT ... FOR UPDATE` serializes concurrent wallet mutations; customer `available_balance_minor >= 0` holds under concurrency.
- **Operator Check:** Call `GET /api/v1/ledger/reconcile/:walletId` to verify `ledgerMatch === true` and `availableMatch === true`.

## Incident 5 — Refresh Token Compromise / Reuse Detection

- **Signals:** `REFRESH_TOKEN_REUSE_DETECTED` in `audit_events`.
- **Expected System Behavior:** Whole token family and associated session revoked automatically.
- **Operator Action:** Contact synthetic user to reauthenticate; review recent `audit_events` for that `actor_id`.

## Incident 6 — Suspicious Activity / High-Risk Alert Escalation

- **Signals:** Spike in `risk_alerts` with `severity IN ('HIGH', 'CRITICAL')` or `metrics.counters.riskFallbacks` increasing (`FAIL_OPEN` degradation).
- **Expected System Behavior:** Risk scoring returns decision-support scores (`0`–`100`) without silently corrupting ledger state; `HIGH`/`CRITICAL` alerts open `OPEN` `risk_alerts` linked to `risk_assessments`.
- **Operator Action:** Inspect evidence on `/risk-alerts` and linked transfers in `/operations`, verify customer identity/beneficiary age, optionally freeze suspect wallet via `PATCH /api/v1/wallets/:id/status` (`Step-Up`), and resolve alert with investigation note.

## Incident 7 — Outbox Backlog & Notification Dead-Letter Recovery

- **Signals:** Growing `PENDING` / `FAILED` rows in `outbox_events`, webhook/transfer notifications delayed.
- **Expected System Behavior:** Outbox dispatcher retries with bounded exponential backoff (`retry_count <= 5`) before dead-lettering as `FAILED`; PostgreSQL `idx_notification_jobs_outbox_channel_unique` prevents duplicate delivery on replay.
- **Operator Action:** Query `GET /api/v1/admin/outbox/failed`, remediate downstream worker/Redis connectivity, and replay events safely via `POST /api/v1/admin/outbox/:id/replay`.
