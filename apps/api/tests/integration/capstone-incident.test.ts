import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
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

/**
 * Assessment 15 — Capstone Incident Simulation
 *
 * Exercises all 4 high-severity production-like failure modes together:
 * 1. Burst of concurrent transfers competing for limited wallet funds
 * 2. Duplicate/replayed payment webhook deliveries
 * 3. Failed payment settlement event (no false ledger credit)
 * 4. Operator compensating reversal after post-settlement issue
 *
 * Verifies recovery invariants:
 * - Zero negative customer wallet balances
 * - Exact projection-vs-derived ledger parity per wallet
 * - Global double-entry invariant: SUM(debits) === SUM(credits) across all posted journals
 * - No journal or ledger entry deleted/mutated
 */
describe('Capstone Incident Simulation (Assessment 15)', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('survives concurrent transfers, duplicate webhooks, failed settlement, and compensating reversal with balanced ledger', async () => {
    const db = getDb();
    const customerA = await registerUser({ email: 'capstone-a@fincore.test' });
    const customerB = await registerUser({ email: 'capstone-b@fincore.test' });
    const financeAdmin = await registerUser({
      email: 'capstone-finance@fincore.test',
      roles: ['FINANCE_ADMIN', 'OPERATIONS_ANALYST'],
    });

    const walletA = await createFundedWallet(customerA.tokens.accessToken, customerA.user.id, 100_000);
    const walletB = await createFundedWallet(customerB.tokens.accessToken, customerB.user.id, 0);

    // ── Phase A: Duplicate Payment Webhook ──
    const piSuccess = await request(app)
      .post('/api/v1/payment-intents')
      .set('Authorization', `Bearer ${customerA.tokens.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ walletId: walletA.id, amountMinor: 50_000, currency: 'INR', description: 'Top-up 1' });
    expect(piSuccess.status).toBe(201);

    const whCaptured = sandboxProvider.generateWebhookPayload(
      piSuccess.body.data.provider_reference,
      'payment.captured',
      50_000,
      'INR',
      config.SANDBOX_WEBHOOK_SECRET,
    );

    const [wh1, wh2] = await Promise.all([
      request(app)
        .post('/api/v1/webhooks/sandbox')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', whCaptured.signature)
        .send(whCaptured.body),
      request(app)
        .post('/api/v1/webhooks/sandbox')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', whCaptured.signature)
        .send(whCaptured.body),
    ]);
    expect([wh1.body.data.status, wh2.body.data.status].sort()).toEqual(['duplicate', 'processed']);

    // Wallet A should now have 100,000 + 50,000 = 150,000 paise (credited ONCE)
    let reconA = await ledgerService.reconcileWalletBalance(walletA.id);
    expect(reconA?.projection.availableBalance).toBe(150_000);

    // ── Phase B: Failed Settlement ──
    const piFailed = await request(app)
      .post('/api/v1/payment-intents')
      .set('Authorization', `Bearer ${customerA.tokens.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ walletId: walletA.id, amountMinor: 75_000, currency: 'INR', description: 'Top-up failed' });

    const whFailed = sandboxProvider.generateWebhookPayload(
      piFailed.body.data.provider_reference,
      'settlement.failed',
      75_000,
      'INR',
      config.SANDBOX_WEBHOOK_SECRET,
    );
    const failedWhRes = await request(app)
      .post('/api/v1/webhooks/sandbox')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', whFailed.signature)
      .send(whFailed.body);
    expect(failedWhRes.status).toBe(200);
    expect(failedWhRes.body.data.status).toBe('failed_recorded');

    // Failed settlement MUST NOT credit wallet A
    reconA = await ledgerService.reconcileWalletBalance(walletA.id);
    expect(reconA?.projection.availableBalance).toBe(150_000);

    // ── Phase C: Concurrent Competing Transfers (6 x 40,000 = 240,000 against 150,000 available -> max 3 succeed) ──
    const stepA = await obtainStepUpToken(customerA.tokens.accessToken, customerA.password, 'TRANSFER');
    const parallelTransfers = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post('/api/v1/transfers')
          .set('Authorization', `Bearer ${customerA.tokens.accessToken}`)
          .set('X-Step-Up-Token', stepA)
          .set('Idempotency-Key', randomUUID())
          .send({
            sourceWalletId: walletA.id,
            destinationWalletId: walletB.id,
            amountMinor: 40_000,
            currency: 'INR',
          }),
      ),
    );
    const completed = parallelTransfers.filter((r) => r.status === 201);
    const rejected = parallelTransfers.filter((r) => r.status === 422);
    expect(completed).toHaveLength(3);
    expect(rejected).toHaveLength(3);

    // Remaining on A = 150,000 - 120,000 = 30,000; B = 120,000
    reconA = await ledgerService.reconcileWalletBalance(walletA.id);
    let reconB = await ledgerService.reconcileWalletBalance(walletB.id);
    expect(reconA?.projection.availableBalance).toBe(30_000);
    expect(reconB?.projection.availableBalance).toBe(120_000);

    // ── Phase D: Compensating Reversal of One Completed Transfer ──
    const stepAdmin = await obtainStepUpToken(financeAdmin.tokens.accessToken, financeAdmin.password, 'REVERSAL');
    const targetTransferId = completed[0]!.body.data.id as string;
    const revRes = await request(app)
      .post('/api/v1/reversals')
      .set('Authorization', `Bearer ${financeAdmin.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepAdmin)
      .set('Idempotency-Key', randomUUID())
      .send({ transferId: targetTransferId, reason: 'Capstone incident simulation compensating reversal' });
    expect(revRes.status).toBe(201);
    expect(revRes.body.data.status).toBe('REVERSED');

    // Final invariant verification across ALL wallets & global ledger
    reconA = await ledgerService.reconcileWalletBalance(walletA.id);
    reconB = await ledgerService.reconcileWalletBalance(walletB.id);
    expect(reconA?.projection.ledgerBalance).toBe(70_000);
    expect(reconA?.ledgerMatch).toBe(true);
    expect(reconB?.projection.ledgerBalance).toBe(80_000);
    expect(reconB?.ledgerMatch).toBe(true);

    const globalCheck = await ledgerService.getGlobalLedgerInvariantCheck();
    expect(globalCheck.balanced).toBe(true);
    expect(globalCheck.unbalancedJournals).toEqual([]);
    expect(globalCheck.totalDebits).toBe(globalCheck.totalCredits);

    // Verify both original TRANSFER journal and compensating REVERSAL journal remain intact
    const journals = await db('journal_transactions').where({ reference_id: targetTransferId });
    expect(journals.map((j) => j.type).sort()).toEqual(['REVERSAL', 'TRANSFER']);
  });
});
