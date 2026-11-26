# Assessment 01 — Financial Customer & Operations Frontend

## 1. Objective & Scope
Deliver a responsive, accessible Next.js App Router + TypeScript + Tailwind CSS frontend supporting both customer financial workflows and operations/finance/admin workflows, with explicit **SIMULATED BALANCE** labels, loading/empty/error states, and zero token storage in `localStorage`.

## 2. Implemented Components & Code Paths
- Layout & Auth Provider: `apps/web/src/app/layout.tsx`, `apps/web/src/app/providers.tsx`, `apps/web/src/lib/auth/auth-context.tsx`
- Typed API Client & In-Memory Auth Store: `apps/web/src/lib/api/client.ts` (uses in-memory access token + `credentials: 'include'` HttpOnly cookie refresh with `X-CSRF-Token`)
- Shared UI Primitives & Step-Up Modal: `apps/web/src/components/ui/primitives.tsx`, `apps/web/src/components/navigation/app-shell.tsx`
- Public Pages: `apps/web/src/app/page.tsx`, `apps/web/src/app/(public)/login/page.tsx`, `apps/web/src/app/(public)/register/page.tsx`
- Customer Pages: `apps/web/src/app/(customer)/dashboard/page.tsx`, `profile/page.tsx`, `wallets/page.tsx`, `beneficiaries/page.tsx`, `transfers/page.tsx`, `payments/page.tsx`, `statements/page.tsx`, `disputes/page.tsx`
- Operations / Finance / Admin Pages: `apps/web/src/app/(operations)/operations/page.tsx`, `risk-alerts/page.tsx`, `reconciliation/page.tsx`, `admin/page.tsx`

## 3. Design Decisions
- Short-lived access JWTs stay strictly in memory (`inMemoryAccessToken`), never `localStorage`. Silent session restoration uses `HttpOnly`, `SameSite=Lax` refresh cookies + `fincore_csrf` double-submit validation (`docs/ASSUMPTIONS.md` A15).
- Customer balances display explicit **SIMULATED AVAILABLE BALANCE** labels and masked UUIDs (`maskIdentifier`) while allowing wallet ID copy for beneficiary creation.
- Sensitive flows (`transfers`, `beneficiaries`, `refunds`/`reversals`, `admin` role/status updates) require interactive confirmation through `StepUpDialog` (password reauthentication or SIMULATED MFA), with `AppShell` enforcing client navigation guards alongside authoritative API RBAC.

## 4. Test Commands & Actual Results
- `pnpm --filter @fincore/web run typecheck` -> `tsc --noEmit` exited `0`.
- `pnpm --filter @fincore/web run lint` -> `next lint` reported `No ESLint warnings or errors`.
- `pnpm --filter @fincore/web run test` -> Vitest + React Testing Library (`apps/web/tests/components/ui.test.tsx`): **1 test file passed, 6/6 tests passed** (`formatInrMinor`, `maskIdentifier`, `AlertBanner`/`Card`/`Badge`/`EmptyState`, `StepUpDialog` password/MFA/Escape handling, disabled `Button`).
- `pnpm --filter @fincore/web run build` -> `next build` exited `0`, building **18/18 static & app routes**.
- Playwright Chromium E2E (`apps/web/tests/e2e/fincore.spec.ts`) against live Next.js + Express API + FastAPI Risk + PostgreSQL 18: **2/2 tests passed (`6.4s`)**, including responsive `1280x800` desktop and `390x844` mobile views.

## 5. Evidence References
- UI Component Tests: `apps/web/tests/components/ui.test.tsx`
- Playwright E2E Spec: `apps/web/tests/e2e/fincore.spec.ts`
- Responsive Screenshots: `docs/evidence/customer-dashboard-desktop.png`, `docs/evidence/customer-dashboard-mobile.png`, `docs/evidence/operations-console.png`

## 6. Known Limitations & Remaining Work
- Automated E2E verified authentication, navigation, responsive rendering, ledger/risk/reconciliation UI, and profile sessions; end-to-end financial mutation flows are verified across the 38 API integration/security tests and component tests.
