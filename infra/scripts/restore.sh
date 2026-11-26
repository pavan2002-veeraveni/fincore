#!/usr/bin/env bash
set -euo pipefail

# FinCore Backup Restore & Ledger Invariant Verification Drill
# Usage: TARGET_DATABASE_URL=... [BACKUP_PASSPHRASE=...] ./infra/scripts/restore.sh <backup_file>

BACKUP_FILE="${1:-}"
if [[ -z "${BACKUP_FILE}" || ! -f "${BACKUP_FILE}" ]]; then
  echo "Usage: TARGET_DATABASE_URL=... ./infra/scripts/restore.sh <backup_file>" >&2
  exit 1
fi

if [[ -z "${TARGET_DATABASE_URL:-}" ]]; then
  echo "ERROR: TARGET_DATABASE_URL must be set to a clean target database" >&2
  exit 1
fi

START_TS="$(date +%s)"
BACKUP_DIR="$(dirname "${BACKUP_FILE}")"
BACKUP_BASENAME="$(basename "${BACKUP_FILE}")"

if [[ -f "${BACKUP_FILE}.sha256" ]]; then
  echo "[FinCore Restore] Verifying backup SHA-256 checksum..."
  (cd "${BACKUP_DIR}" && sha256sum -c "${BACKUP_BASENAME}.sha256")
else
  echo "WARNING: No .sha256 checksum file found alongside ${BACKUP_FILE}" >&2
  if [[ "${REQUIRE_CHECKSUM:-false}" == "true" ]]; then
    exit 1
  fi
fi

echo "[FinCore Restore] Restoring into target database..."
if [[ "${BACKUP_FILE}" == *.enc ]]; then
  if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
    echo "ERROR: BACKUP_PASSPHRASE required for encrypted backup" >&2
    exit 1
  fi
  openssl enc -d -aes-256-cbc -pbkdf2 -in "${BACKUP_FILE}" -pass env:BACKUP_PASSPHRASE | gunzip | psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 >/dev/null
else
  gunzip -c "${BACKUP_FILE}" | psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 >/dev/null
fi

echo "[FinCore Restore] Verifying post-restore ledger & integrity invariants..."
psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  COUNT(DISTINCT jt.id) AS posted_journals,
  COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT' THEN le.amount_minor ELSE 0 END), 0) AS total_debits,
  COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount_minor ELSE 0 END), 0) AS total_credits
FROM journal_transactions jt
JOIN ledger_entries le ON le.journal_transaction_id = jt.id
WHERE jt.status = 'POSTED';

DO $$
DECLARE
  unbalanced_count INTEGER;
  overdrawn_count INTEGER;
  projection_drift_count INTEGER;
  role_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO role_count FROM roles;
  IF role_count < 5 THEN
    RAISE EXCEPTION 'RESTORE FAILED: expected >= 5 RBAC roles, found %', role_count;
  END IF;

  SELECT COUNT(*) INTO unbalanced_count FROM (
    SELECT jt.id
    FROM journal_transactions jt
    LEFT JOIN ledger_entries le ON le.journal_transaction_id = jt.id
    WHERE jt.status = 'POSTED'
    GROUP BY jt.id
    HAVING COUNT(le.id) < 2
       OR COUNT(DISTINCT le.currency) != 1
       OR COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT' THEN le.amount_minor ELSE 0 END), 0)
       != COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount_minor ELSE 0 END), 0)
  ) t;

  IF unbalanced_count > 0 THEN
    RAISE EXCEPTION 'RESTORE FAILED: % unbalanced posted journals found', unbalanced_count;
  END IF;

  SELECT COUNT(*) INTO overdrawn_count
  FROM wallets
  WHERE wallet_type = 'CUSTOMER' AND available_balance_minor < 0;

  IF overdrawn_count > 0 THEN
    RAISE EXCEPTION 'RESTORE FAILED: % negative customer wallets found', overdrawn_count;
  END IF;

  SELECT COUNT(*) INTO projection_drift_count
  FROM wallets w
  WHERE w.ledger_balance_minor != COALESCE((
    SELECT SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount_minor ELSE -le.amount_minor END)
    FROM ledger_entries le
    JOIN journal_transactions jt ON jt.id = le.journal_transaction_id
    WHERE le.wallet_id = w.id AND jt.status = 'POSTED'
  ), 0);

  IF projection_drift_count > 0 THEN
    RAISE EXCEPTION 'RESTORE FAILED: % wallets have projection drift vs ledger_entries', projection_drift_count;
  END IF;
END $$;
SQL

END_TS="$(date +%s)"
echo "[FinCore Restore] Drill passed in $((END_TS - START_TS))s — all ledger & projection invariants verified."
