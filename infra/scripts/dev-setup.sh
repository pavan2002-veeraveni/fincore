#!/usr/bin/env bash
set -euo pipefail

# FinCore Local Developer Setup Helper
echo "=== FinCore Developer Setup ==="

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example (synthetic placeholders — update secrets before staging)."
fi

pnpm install --frozen-lockfile
pnpm --filter @fincore/contracts run build
pnpm --filter @fincore/api run db:migrate
pnpm --filter @fincore/api run db:seed

echo "Setup complete. Run 'pnpm dev' and start backend/risk with 'uvicorn app.main:app --app-dir backend/risk --port 8000'."
