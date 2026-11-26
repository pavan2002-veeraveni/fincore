#!/usr/bin/env bash
set -euo pipefail

# FinCore PostgreSQL Encrypted Backup Script
# Usage: DATABASE_URL=... BACKUP_PASSPHRASE=... ./infra/scripts/backup.sh [output_dir]

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE_NAME="fincore_${TIMESTAMP}.sql.gz"

mkdir -p "${OUTPUT_DIR}"
chmod 700 "${OUTPUT_DIR}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL must be set" >&2
  exit 1
fi

echo "[FinCore Backup] Creating consistent snapshot..."
if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  TARGET_NAME="${BASE_NAME}.enc"
  pg_dump "${DATABASE_URL}" --no-owner --no-privileges --format=plain \
    | gzip -9 \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -out "${OUTPUT_DIR}/${TARGET_NAME}" -pass env:BACKUP_PASSPHRASE
  (cd "${OUTPUT_DIR}" && sha256sum "${TARGET_NAME}" > "${TARGET_NAME}.sha256")
  chmod 600 "${OUTPUT_DIR}/${TARGET_NAME}" "${OUTPUT_DIR}/${TARGET_NAME}.sha256"
  echo "[FinCore Backup] Encrypted backup created: ${OUTPUT_DIR}/${TARGET_NAME}"
else
  if [[ "${REQUIRE_ENCRYPTION:-false}" == "true" ]]; then
    echo "ERROR: BACKUP_PASSPHRASE is required when REQUIRE_ENCRYPTION=true" >&2
    exit 1
  fi
  pg_dump "${DATABASE_URL}" --no-owner --no-privileges --format=plain | gzip -9 > "${OUTPUT_DIR}/${BASE_NAME}"
  (cd "${OUTPUT_DIR}" && sha256sum "${BASE_NAME}" > "${BASE_NAME}.sha256")
  chmod 600 "${OUTPUT_DIR}/${BASE_NAME}" "${OUTPUT_DIR}/${BASE_NAME}.sha256"
  echo "[FinCore Backup] Unencrypted dev backup created (set BACKUP_PASSPHRASE for encryption): ${OUTPUT_DIR}/${BASE_NAME}"
fi
