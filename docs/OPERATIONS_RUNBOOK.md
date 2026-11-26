# FinCore Operations Runbook

## 1. Service Health & Readiness Endpoints

- **Express API:** `GET /api/v1/health/live` (process liveness) & `GET /api/v1/health/ready` (PostgreSQL connectivity verification plus non-blocking Risk service & Redis probe status)
- **FastAPI Risk:** `GET /health/live` & `GET /health/ready`
- **Nginx Reverse Proxy:** `GET /nginx-health`
- **Protected Operational Metrics:** `GET /api/v1/metrics` (requires `OPERATIONS_ANALYST`, `FINANCE_ADMIN`, or `PLATFORM_ADMIN`)

## 2. Database Migrations & Synthetic Seeding

```bash
pnpm --filter @fincore/api run db:migrate
pnpm --filter @fincore/api run db:seed
```

Migrations `001`–`005` create all financial tables, constraints, `prevent_ledger_entry_mutation()`, `enforce_ledger_entry_not_posted()`, `enforce_dispute_event_immutability()`, `check_journal_balance()`, and deterministic `SYSTEM_CLEARING` / `SYSTEM_FEE` / `SYSTEM_SUSPENSE` accounts.

## 3. Queue Backlog & Dead-Letter Recovery

1. Inspect failed outbox events: `GET /api/v1/admin/outbox/failed`
2. Diagnose transient downstream failure (`outbox_events.error` & `retry_count`).
3. Replay safe idempotent event: `POST /api/v1/admin/outbox/:id/replay`.

## 4. Risk Service Degradation Policy (ASSUMPTIONS.md A10)

- **Timeouts:** Express enforces a 3,000 ms `AbortController` timeout calling `POST /api/v1/assess`.
- **Transfers (`FAIL_OPEN`):** If FastAPI is unreachable or times out, API returns a fallback score (`0 / LOW`) with `warning` metadata and logs metric `riskFallbacks`. Operations must monitor elevated `riskFallbacks` and manually sample recent transfers via `GET /api/v1/transfers`.
- **Sensitive Admin/Review (`FAIL_CLOSED`):** Returns `503 RISK_SERVICE_UNAVAILABLE`.

## 5. Backup & Restore Drill Procedure

```bash
DATABASE_URL=postgresql://fincore:...@localhost:5432/fincore_dev \
BACKUP_PASSPHRASE="..." \
./infra/scripts/backup.sh ./backups

TARGET_DATABASE_URL=postgresql://fincore:...@localhost:5432/fincore_restore_drill \
BACKUP_PASSPHRASE="..." \
./infra/scripts/restore.sh ./backups/fincore_<timestamp>.sql.gz.enc
```
`restore.sh` automatically verifies checksum, decrypts, restores, and asserts `SUM(debits) == SUM(credits)` and zero negative customer wallets.
