# Assessment 08 — Payment & Notification Integrations

## 1. Objective & Scope
Provide a sandbox payment provider integration with raw-body constant-time HMAC-SHA256 webhook verification, timestamp tolerance, database-level deduplication, reconciliation exceptions on mismatches/failed settlements, transactional outbox dispatch, BullMQ retry backoff / dead-letter recovery, and sandbox Email/SMS notification adapters.

## 2. Implemented Components & Code Paths
- Sandbox Provider Adapter: `apps/api/src/infrastructure/providers/sandbox-provider.ts`
- Payments & Webhooks Modules: `apps/api/src/modules/payments/*`, `apps/api/src/modules/webhooks/*`
- Refunds & Reversals: `apps/api/src/modules/refunds/*`
- Outbox Dispatcher, BullMQ Worker & Sandbox Notifications: `apps/api/src/infrastructure/queue/outbox-dispatcher.ts`, `apps/api/src/worker.ts`, `apps/api/src/modules/notifications/notifications.service.ts`

## 3. Design Decisions
- `express.raw({ type: '*/*', limit: '1mb' })` captures raw bytes on `/api/v1/webhooks` before any JSON parser alters whitespace.
- Signature checked via `crypto.timingSafeEqual`; provider path restricted to `sandbox`; timestamp tolerance is 5 minutes; `INSERT INTO provider_events ... ON CONFLICT (provider_name, provider_event_id) DO NOTHING RETURNING id` prevents concurrent webhook double-crediting.
- Webhook payment settlements debit `SYSTEM_CLEARING` wallet and credit customer wallet (`postedBy: SYSTEM_USER_ID`). `POST /payment-intents`, `POST /refunds`, and `POST /reversals` enforce `Idempotency-Key` + `lockIdempotencyScope`.
- On `payment.failed` / `settlement.failed`, intent transitions cleanly to `FAILED` without posting false wallet credits; post-capture failures or amount mismatches persist `reconciliation_exceptions` (`OPEN`).
- Outbox dispatcher claims pending jobs with `FOR UPDATE SKIP LOCKED`, enforces per-channel delivery uniqueness (`idx_notification_jobs_outbox_channel_unique`), uses unique per-attempt BullMQ `jobId` (`${id}:${retryCount}:${ts}`) so DLQ replays never collide with failed jobs, and runs safely in direct DB fallback mode when Redis is unavailable (`pollPendingOutboxEvents(null)`).

## 4. Test Commands & Actual Results
- `apps/api/tests/unit/webhook-signature.test.ts` (**4/4 passed**): HMAC validation, tampered byte rejection, request hash ordering, backoff bounds.
- `apps/api/tests/integration/concurrency.test.ts` (`deduplicates concurrent webhook deliveries`): **5 simultaneous identical webhooks** -> **1 processed, 4 deduplicated (`duplicate`)**, wallet credited once.
- `apps/api/tests/integration/webhooks-refunds.test.ts` (**3/3 passed**) & `hardening.test.ts` (**4/4 passed**): rejected invalid signature (`400`), stale timestamp (`400`), persisted `AMOUNT_MISMATCH` exception (`OPEN`), enforced `Idempotency-Key` + recipient-return vs sender-pull refund ownership, processed `outbox_events` into `notification_jobs` (`SENT`), and verified DLQ `replayDeadLetterOutboxEvent` recovery.

## 5. Evidence References
- `apps/api/tests/integration/webhooks-refunds.test.ts`
- `apps/api/tests/unit/webhook-signature.test.ts`

## 6. Known Limitations & Remaining Work
- Real payment rails (Razorpay/Stripe) and live SMTP/SMS gateways are intentionally omitted (`ASSUMPTIONS.md` A7); BullMQ-via-Redis live broker path was not runtime-tested locally because Redis server is not installed on the local Windows workstation (verified fallback DB dispatch path directly).
