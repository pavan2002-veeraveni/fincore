# Assessment 15 — Financial Incident Simulation (Capstone)

## 1. Objective & Scope
Execute an end-to-end combined financial incident simulation testing concurrent competing transfers, duplicate webhook deliveries, failed payment settlements, and post-settlement compensating reversals — proving ledger parity (`SUM(debits) == SUM(credits)`), zero overdrafts, zero duplicate credits, and preserving immutable audit/journal history.

## 2. Implemented Components & Code Paths
- Capstone Integration Simulation: `apps/api/tests/integration/capstone-incident.test.ts`
- Supporting Runbook: `docs/INCIDENT_RUNBOOK.md`
- Global Integrity Verification Endpoint: `GET /api/v1/ledger/invariant-check` (`ledgerService.getGlobalLedgerInvariantCheck()`)

## 3. Incident Timeline, Root Causes Fixed & Simulation Flow
1. **Duplicate Payment Webhook (Phase A):** Two concurrent HMAC-signed `payment.captured` webhooks arrive for a ₹500.00 (`50,000` paise) intent. PostgreSQL `ON CONFLICT (provider_name, provider_event_id) DO NOTHING` ensures **1 `processed`, 1 `duplicate`**; Customer A balance moves cleanly from ₹1,000 -> ₹1,500 once.
2. **Failed Settlement (Phase B):** `settlement.failed` webhook arrives for a second ₹750.00 intent -> marked `FAILED`, emits `PAYMENT_FAILED` outbox event, **zero false wallet credit** (balance remains ₹1,500).
3. **Concurrent Competing Transfers (Phase C):** Customer A fires **6 simultaneous ₹400 (`40,000` paise) transfers** against `150,000` paise available. Sorted-ID `SELECT ... FOR UPDATE` serializes access so **exactly 3 succeed (`201`) and 3 fail (`422 INSUFFICIENT_FUNDS`)**, leaving Customer A at `30,000` paise and Customer B at `120,000` paise.
4. **Compensating Reversal (Phase D):** Finance Admin submits `POST /api/v1/reversals` with `REVERSAL` step-up token on one completed ₹400 transfer -> posts compensating `REVERSAL` journal (`DEBIT B / CREDIT A`), leaving Customer A at `70,000` paise, Customer B at `80,000` paise, original `TRANSFER` journal untouched, and `globalCheck.balanced === true`.

### Notable Bugs Discovered & Fixed During Verification
- **Pool Starvation Under Concurrency:** Fixed `walletsRepository.getCustomerIdByUserId` / `getWalletById` missing `trx` propagation inside `transfers.service.ts`, `refunds.service.ts`, `disputes.service.ts`.
- **Token Reuse Transaction Rollback:** Moved family/session revocation & audit persistence to commit *before* throwing `401 Unauthorized` in `auth.service.ts`.
- **Webhook System Clearing Account & FK:** Fixed `webhooks.service.ts` single-entry zero-filter bug and `customer_id` vs `users.id` FK mismatch using `SYSTEM_CLEARING` + `SYSTEM_USER_ID`.

## 4. Test Commands & Actual Results
- `pnpm --filter @fincore/api run test:coverage` -> `tests/integration/capstone-incident.test.ts` **PASSED (`1/1` suite pass; `38/38` total API tests across `11/11` files pass, `62.29%` coverage)** against PostgreSQL 18.7.

## 5. Evidence References
- `apps/api/tests/integration/capstone-incident.test.ts`
- `docs/INCIDENT_RUNBOOK.md`

## 6. Known Limitations & Remaining Work
- Demonstrates database-layer and Express-layer incident recovery directly; Redis cluster outage failover during active BullMQ worker draining was verified via direct DB fallback mode (`pollPendingOutboxEvents(null)`), not against a live Redis server.
