# Assessment 07 — Transfer Consistency Engine

## 1. Objective & Scope
Guarantee atomic, race-free transfers supporting idempotency fingerprinting (`Idempotency-Key`), sorted deterministic PostgreSQL row locking (`ORDER BY id FOR UPDATE`), active holds (`PENDING_CONFIRMATION -> PROCESSING -> COMPLETED | CANCELLED`), state machine enforcement, audit trails, and transactional outbox emission.

## 2. Implemented Components & Code Paths
- Transfer Service, Repository, Controller, Schemas, Routes: `backend/api/src/modules/transfers/*`
- Idempotency Utility: `backend/api/src/shared/security/idempotency.ts` (`computeRequestHash`, `checkIdempotency`, `saveIdempotencyRecord`)
- State Machines: `backend/api/src/shared/state-machine.ts`
- Hold Primitives: `ledgerService.placeHold`, `captureHoldAndPost`, `releaseHold` (`backend/api/src/modules/ledger/ledger.service.ts`)

## 3. Design Decisions
- Affected wallets are always sorted ascending by UUID before `WHERE id IN (...) ORDER BY id FOR UPDATE` so concurrent bidirectional A→B and B→A transfers cannot deadlock, and destination wallets are restricted to `wallet_type = 'CUSTOMER'` (`SYSTEM_*` targets blocked).
- All queries inside `db.transaction(async (trx) => ...)` strictly propagate `trx` (fixed after concurrency test uncovered a connection-pool starvation bug on `getCustomerIdByUserId`).
- Concurrent identical idempotency requests serialize cleanly with `pg_advisory_xact_lock` (`lockIdempotencyScope`); same user + key + hash -> cached `200`, while altered `amount`, destination, or `description` -> `409 IDEMPOTENCY_KEY_REUSED`.

## 4. Test Commands & Actual Results
- `backend/api/tests/integration/transfers.test.ts` (**2/2 passed**) & `hardening.test.ts` (**4/4 passed**): verified step-up required (`403`), missing key (`400`), immediate atomic completion (`201`), concurrent same-key serialization, mismatched payload conflict (`409`), `SYSTEM_*` wallet target blocking, two-step hold/confirm (`COMPLETED`), and cancel (`CANCELLED` with hold released).
- `backend/api/tests/integration/concurrency.test.ts` (**3/3 passed**):
  - **10 parallel ₹300 transfers** from ₹1,000 wallet -> **exactly 3 succeeded (`201`), 7 rejected (`422 INSUFFICIENT_FUNDS`)**, final balance exact `10,000` paise (`₹100.00`).
  - **10 parallel bidirectional A→B / B→A transfers** -> **all 10 succeeded with zero deadlocks** and ledger parity preserved.

## 5. Evidence References
- `backend/api/tests/integration/transfers.test.ts`
- `backend/api/tests/integration/concurrency.test.ts`

## 6. Known Limitations & Remaining Work
- Expiry sweep cron for abandoned `PENDING_CONFIRMATION` holds past `expires_at` relies on manual cancel or future scheduled worker job.
