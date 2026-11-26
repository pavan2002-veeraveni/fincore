# FinCore — Educational Simulated Wallet, Ledger & Payment Platform

> **Safety Boundary:** FinCore is a simulated educational engineering platform. **It never processes real funds, collects real banking credentials, or claims regulatory compliance.** All customers, balances, providers, MFA codes, and notifications are synthetic sandboxes.

## Architecture

- **`apps/web`** — Next.js App Router + TypeScript + Tailwind customer & operations dashboards (memory tokens + HttpOnly refresh cookie).
- **`apps/api`** — Express + TypeScript modular monolith owning all business rules, atomic double-entry ledger postings, idempotency, row locking, HMAC webhooks, disputes, reconciliation, and audit records.
- **`apps/api/src/worker.ts`** — BullMQ + PostgreSQL outbox worker dispatching sandbox Email/SMS notifications with exponential backoff and DLQ replay.
- **`services/risk`** — Independently deployable FastAPI + Pydantic service computing exact Python `Decimal` financial calculations and decision-support risk rules.
- **`packages/contracts`** — Shared Zod schemas, role/status enums, and minor-unit money formatters.
- **PostgreSQL 16+** — System of record with immutable `ledger_entries`/`audit_events` triggers and `DEFERRABLE` journal balance triggers.

## Quick Start (Local Development)

1. Copy `.env.example` to `.env` and populate placeholder secrets.
2. Install workspace dependencies:
   ```bash
   pnpm install
   pnpm --filter @fincore/contracts run build
   ```
3. Run PostgreSQL migrations & synthetic seed data:
   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```
4. Start Express API, Next.js Web, and FastAPI Risk Service:
   ```bash
   pnpm --filter @fincore/api run dev
   pnpm --filter @fincore/web run dev
   uvicorn app.main:app --app-dir services/risk --port 8000 --reload
   ```
5. Docker Compose stack (for environments with Docker Engine installed):
   ```bash
   docker compose up -d --build
   ```

## Synthetic Seed Accounts (Password: `FinCore@2026!`)

- Customer 1: `customer1@fincore.test` (₹50,000.00 simulated balance)
- Customer 2: `customer2@fincore.test` (₹15,000.00 simulated balance)
- Support Agent: `support@fincore.test`
- Operations Analyst: `analyst@fincore.test`
- Finance Admin: `finance@fincore.test`
- Platform Admin: `admin@fincore.test`

## Verification Commands

- **API Unit, Integration, Concurrency, Security & Capstone Tests:** `pnpm --filter @fincore/api run test:coverage`
- **Python Risk & Decimal Calculations:** `cd services/risk && python -m pytest -v --cov=app`
- **Frontend Component Tests & Build:** `pnpm --filter @fincore/web run test && pnpm --filter @fincore/web run build`
- **Assessment Evidence Matrix:** [EVIDENCE_MATRIX.md](./docs/EVIDENCE_MATRIX.md)
