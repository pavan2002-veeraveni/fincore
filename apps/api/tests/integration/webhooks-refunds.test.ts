import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import {
  initTestDb,
  resetTestDb,
  teardownTestDb,
  registerUser,
  obtainStepUpToken,
  createFundedWallet,
} from './setup.js';
import { app } from '../../src/app.js';
import { config } from '../../src/config/index.js';
import { getDb } from '../../src/infrastructure/database/connection.js';
import { sandboxProvider } from '../../src/infrastructure/providers/sandbox-provider.js';
import { ledgerService } from '../../src/modules/ledger/ledger.service.js';
import { pollPendingOutboxEvents, replayDeadLetterOutboxEvent } from '../../src/infrastructure/queue/outbox-dispatcher.js';

describe('Webhooks, Refunds/Reversals, Disputes, Reconciliation & Outbox (Assessment 08 & Workflows B-E)', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('rejects invalid signatures, stale timestamps, and records reconciliation exceptions on amount mismatch', async () => {
    const customer = await registerUser({ email: 'wh-sec@fincore.test' });
    const wallet = await createFundedWallet(customer.tokens.accessToken, customer.user.id, 0);

    const intentRes = await request(app)
      .post('/api/v1/payment-intents')
      .set('Authorization', `Bearer ${customer.tokens.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ walletId: wallet.id, amountMinor: 40_000, currency: 'INR' });
    expect(intentRes.status).toBe(201);
    const ref = intentRes.body.data.provider_reference as string;

    // 1. Invalid signature -> 400
    const badSig = await request(app)
      .post('/api/v1/webhooks/sandbox')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', '00'.repeat(32))
      .send(
        JSON.stringify({
          event_id: 'evt_bad_sig',
          event_type: 'payment.captured',
          created_at: new Date().toISOString(),
          data: { order_id: ref, amount_minor: 40_000, currency: 'INR', status: 'paid' },
        }),
      );
    expect(badSig.status).toBe(400);

    // 2. Stale timestamp (> 5 min) -> 400
    const stalePayload = JSON.stringify({
      event_id: 'evt_stale',
      event_type: 'payment.captured',
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      data: { order_id: ref, amount_minor: 40_000, currency: 'INR', status: 'paid' },
    });
    const staleSig = createHmac('sha256', config.SANDBOX_WEBHOOK_SECRET)
      .update(stalePayload)
      .digest('hex');
    const staleRes = await request(app)
      .post('/api/v1/webhooks/sandbox')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', staleSig)
      .send(stalePayload);
    expect(staleRes.status).toBe(400);

    // 3. Amount mismatch -> 400 AND persists OPEN reconciliation_exception
    const mismatchPayload = sandboxProvider.generateWebhookPayload(
      ref,
      'payment.captured',
      99_999,
      'INR',
      config.SANDBOX_WEBHOOK_SECRET,
    );
    const mismatchRes = await request(app)
      .post('/api/v1/webhooks/sandbox')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', mismatchPayload.signature)
      .send(mismatchPayload.body);
    expect(mismatchRes.status).toBe(400);

    const exceptions = await getDb()('reconciliation_exceptions').where({ exception_type: 'AMOUNT_MISMATCH' });
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].status).toBe('OPEN');
  });

  it('processes partial refunds, rejects over-refunds, preserves original ledger lines, and supports reversals', async () => {
    const alice = await registerUser({ email: 'ref-a@fincore.test' });
    const bob = await registerUser({ email: 'ref-b@fincore.test' });
    const ops = await registerUser({ email: 'ref-ops@fincore.test', roles: ['FINANCE_ADMIN'] });

    const wAlice = await createFundedWallet(alice.tokens.accessToken, alice.user.id, 100_000);
    const wBob = await createFundedWallet(bob.tokens.accessToken, bob.user.id, 0);

    const stepAlice = await obtainStepUpToken(alice.tokens.accessToken, alice.password, 'TRANSFER');
    const transferRes = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepAlice)
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceWalletId: wAlice.id,
        destinationWalletId: wBob.id,
        amountMinor: 50_000,
        currency: 'INR',
      });
    expect(transferRes.status).toBe(201);
    const transferId = transferRes.body.data.id as string;
    const origJournalId = transferRes.body.data.journalTransactionId as string;

    const stepOps = await obtainStepUpToken(ops.tokens.accessToken, ops.password, 'ALL');

    // Partial refund 20,000
    const r1 = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${ops.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepOps)
      .set('Idempotency-Key', randomUUID())
      .send({ transferId, amountMinor: 20_000, reason: 'Partial settlement dispute' });
    expect(r1.status).toBe(201);

    // Excess refund 35,000 (remaining is 30,000) -> 400
    const rExcess = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${ops.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepOps)
      .set('Idempotency-Key', randomUUID())
      .send({ transferId, amountMinor: 35_000, reason: 'Over refund check' });
    expect(rExcess.status).toBe(400);

    // Remaining refund 30,000 -> status becomes REFUNDED
    const r2 = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${ops.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepOps)
      .set('Idempotency-Key', randomUUID())
      .send({ transferId, amountMinor: 30_000, reason: 'Final partial refund' });
    expect(r2.status).toBe(201);

    const reconAlice = await ledgerService.reconcileWalletBalance(wAlice.id);
    expect(reconAlice?.projection.ledgerBalance).toBe(100_000);

    // Verify original journal entries remain intact and unchanged
    const origEntries = await getDb()('ledger_entries').where({ journal_transaction_id: origJournalId });
    expect(origEntries).toHaveLength(2);
    expect(origEntries.some((e) => Number(e.amount_minor) === 50_000 && e.entry_type === 'DEBIT')).toBe(true);

    // Second transfer for full REVERSAL test
    const t2 = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepAlice)
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceWalletId: wAlice.id,
        destinationWalletId: wBob.id,
        amountMinor: 15_000,
        currency: 'INR',
      });
    const revRes = await request(app)
      .post('/api/v1/reversals')
      .set('Authorization', `Bearer ${ops.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepOps)
      .set('Idempotency-Key', randomUUID())
      .send({ transferId: t2.body.data.id, reason: 'Operator reversal test' });
    expect(revRes.status).toBe(201);
    expect(revRes.body.data.status).toBe('REVERSED');

    const check = await ledgerService.getGlobalLedgerInvariantCheck();
    expect(check.balanced).toBe(true);
  });

  it('handles disputes, reconciliation matching/classification, and outbox notifications/DLQ replay', async () => {
    const cust = await registerUser({ email: 'disp-cust@fincore.test' });
    const analyst = await registerUser({ email: 'disp-analyst@fincore.test', roles: ['OPERATIONS_ANALYST', 'PLATFORM_ADMIN'] });
    const wallet = await createFundedWallet(cust.tokens.accessToken, cust.user.id, 10_000);

    // Create two payment intents, capture one via simulated sandbox webhook
    const pi1 = await request(app)
      .post('/api/v1/payment-intents')
      .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ walletId: wallet.id, amountMinor: 25_000, currency: 'INR' });
    const pi2 = await request(app)
      .post('/api/v1/payment-intents')
      .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ walletId: wallet.id, amountMinor: 15_000, currency: 'INR' });

    const sim = await request(app)
      .post(`/api/v1/payment-intents/${pi1.body.data.id}/simulate-webhook`)
      .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
      .send({ eventType: 'payment.captured' });
    expect(sim.status).toBe(200);

    // Outbox dispatcher processes PAYMENT_SUCCEEDED into notification_jobs
    const processedCount = await pollPendingOutboxEvents(null);
    expect(processedCount).toBeGreaterThanOrEqual(1);
    const notifJobs = await getDb()('notification_jobs').where({ user_id: cust.user.id, status: 'SENT' });
    expect(notifJobs.length).toBeGreaterThanOrEqual(1);

    // Test dead-letter replay
    const [failedEvt] = await getDb()('outbox_events')
      .insert({
        event_type: 'TEST_NOTIFICATION',
        aggregate_type: 'TRANSFER',
        aggregate_id: randomUUID(),
        payload: JSON.stringify({ userId: cust.user.id }),
        status: 'FAILED',
        retry_count: 5,
      })
      .returning('*');
    expect(await replayDeadLetterOutboxEvent(failedEvt.id)).toBe(true);
    await pollPendingOutboxEvents(null);
    const afterReplay = await getDb()('outbox_events').where({ id: failedEvt.id }).first();
    expect(afterReplay.status).toBe('COMPLETED');

    // Customer opens dispute
    const disputeRes = await request(app)
      .post('/api/v1/disputes')
      .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
      .send({ paymentIntentId: pi1.body.data.id, reason: 'Unrecognized charge in demo' });
    expect(disputeRes.status).toBe(201);

    // Customer cannot unilaterally close/resolve via status change
    const forbiddenTransition = await request(app)
      .post(`/api/v1/disputes/${disputeRes.body.data.id}/events`)
      .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
      .send({ eventType: 'STATUS_CHANGE', toStatus: 'RESOLVED_ACCEPTED' });
    expect(forbiddenTransition.status).toBe(403);

    // Analyst transitions dispute
    const reviewRes = await request(app)
      .post(`/api/v1/disputes/${disputeRes.body.data.id}/events`)
      .set('Authorization', `Bearer ${analyst.tokens.accessToken}`)
      .send({ eventType: 'STATUS_CHANGE', toStatus: 'UNDER_REVIEW', comment: 'Investigating sandbox trace' });
    expect(reviewRes.status).toBe(201);

    // Run reconciliation classification (1 matched, 1 duplicate, 1 missing internal, 1 missing provider = pi2)
    const today = new Date().toISOString().slice(0, 10);
    const reconRun = await request(app)
      .post('/api/v1/reconciliation/runs')
      .set('Authorization', `Bearer ${analyst.tokens.accessToken}`)
      .send({
        providerName: 'sandbox',
        periodStart: today,
        periodEnd: today,
        providerData: [
          { reference: pi1.body.data.provider_reference, amount_minor: 25_000, currency: 'INR', timestamp: new Date().toISOString() },
          { reference: pi1.body.data.provider_reference, amount_minor: 25_000, currency: 'INR', timestamp: new Date().toISOString() },
          { reference: 'sandbox_order_ghost_999', amount_minor: 5_000, currency: 'INR', timestamp: new Date().toISOString() },
        ],
      });
    expect(reconRun.status).toBe(201);
    expect(reconRun.body.data.matched_count).toBe(1);
    expect(reconRun.body.data.exception_count).toBe(3);
  });
});
