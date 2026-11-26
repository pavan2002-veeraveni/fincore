# FinCore — Implementation Plan

## Overview
FinCore is a simulated digital wallet, ledger, and payment-processing platform built to satisfy 15 mandatory assessments. This plan organizes work into phases that maintain a runnable system at each milestone.

## Phase Summary

| Phase | Scope | Key Deliverables | Assessments |
|-------|-------|-----------------|-------------|
| 0 | Repository assessment & plan | ASSUMPTIONS.md, IMPLEMENTATION_PLAN.md, traceability matrix | 10, 13 |
| 1 | Foundation | Monorepo, configs, DB migrations, seed, Docker Compose, health checks, CI skeleton | 9, 11 |
| 2 | Identity & authorization | Auth module, RBAC, sessions, MFA sim, audit events | 4 |
| 3 | Ledger core | Money type, journal transactions, ledger entries, posting service, balance projection, invariant tests | 3, 5 |
| 4 | Wallets & transfers | Wallets, beneficiaries, transfer state machine, idempotency, concurrency | 2, 7 |
| 5 | Payments, webhooks, refunds | Payment intents, sandbox provider, webhook verification, refunds/reversals, notifications | 8 |
| 6 | Disputes & reconciliation | Dispute workflow, reconciliation engine, exception handling | 2 |
| 7 | Python calculations & risk | FastAPI risk service, Decimal calculations, velocity analytics | 5, 6 |
| 8 | Frontend | Customer & operations dashboards, E2E tests | 1 |
| 9 | Hardening & delivery | Security scans, OpenAPI, Postman, incident simulation, evidence package | 11, 12, 13, 14, 15 |

## Critical Risks

1. **Concurrency correctness** — Row locking must be thoroughly tested. Mitigation: integration tests with parallel requests.
2. **Ledger invariant enforcement** — Must be tested before any transfer UI. Mitigation: phase gate.
3. **Docker unavailable locally** — Dockerfiles created but tested via CI or user's Docker setup.
4. **Context/token limits** — Large codebase. Mitigation: modular incremental implementation.

## Technology Decisions

| Layer | Choice | Justification |
|-------|--------|---------------|
| Monorepo | pnpm workspaces | Native workspace support, efficient disk usage |
| API | Express + TypeScript + Knex | Full SQL control for financial operations |
| Frontend | Next.js 14 + Tailwind + shadcn/ui | Required stack, App Router |
| Risk | FastAPI + Pydantic + pytest | Required Python service |
| DB | PostgreSQL 16 | ACID, constraints, row locking |
| Queue | Redis + BullMQ | Required async job processing |
| Auth | JWT + bcrypt + opaque refresh | Secure, revocable sessions |
| Testing | Vitest (TS), pytest (Python), Playwright (E2E) | Modern, fast, required |
