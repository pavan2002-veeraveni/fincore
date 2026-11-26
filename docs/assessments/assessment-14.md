# Assessment 14 — Secure Deployment & Recovery

## 1. Objective & Scope
Ensure private data-tier networking, TLS/security headers at reverse proxy, non-secret runtime injection, backup encryption with SHA-256 verification, automated post-restore ledger invariant validation, and operational monitoring/runbooks.

## 2. Implemented Components & Code Paths
- Nginx Reverse Proxy & TLS Config Template: `infra/nginx/nginx.conf` (rate limiting zones, security headers, `/risk/` internal CIDR restriction, HSTS/TLSv1.2+ SSL server block template)
- Backup & Restore Drill Scripts: `infra/scripts/backup.sh`, `infra/scripts/restore.sh`
- Monitoring & Metrics: `apps/api/src/infrastructure/metrics/index.ts`, `GET /api/v1/metrics`, `/api/v1/health/live`, `/api/v1/health/ready`
- Documentation & Runbooks: `docs/OPERATIONS_RUNBOOK.md`, `docs/SECURITY.md`

## 3. Design Decisions
- `docker-compose.yml` places PostgreSQL, Redis, FastAPI Risk, and Worker strictly on `fincore-internal` bridge network.
- `backup.sh` stream-encrypts PostgreSQL dumps directly via `openssl` (`AES-256-CBC PBKDF2`) using `BACKUP_PASSPHRASE` without writing unencrypted `.sql.gz` intermediates to disk and creates `.sha256` digests with `chmod 600`.
- `restore.sh` restores into a clean target DB and enforces SQL invariant checks verifying zero unbalanced `POSTED` journals, zero negative `CUSTOMER` wallet balances, and wallet projection vs ledger entry parity before reporting success.

## 4. Test Commands & Actual Results
- Verified real PostgreSQL 18 migrations (`001`–`005`) and synthetic seed script (`seed.ts`) cleanly initialized database state (`5` roles, system accounts, seeded customers/wallets/transfers).
- Live `GET /api/v1/health/ready` returned `200` (`database: ok`, `riskService: ok`) and `/api/v1/metrics` + `GET /api/v1/ledger/invariant-check` verified balanced runtime state.

## 5. Evidence References
- `infra/scripts/backup.sh`, `infra/scripts/restore.sh`
- `infra/nginx/nginx.conf`, `docs/OPERATIONS_RUNBOOK.md`

## 6. Known Limitations & Remaining Work
- Because Docker Engine and cloud DNS/TLS certificates are unavailable locally, TLS termination (`certbot`/certificates) and an end-to-end timed execution of `backup.sh` -> `restore.sh` in a Linux shell have not yet been executed on a staging VM.
