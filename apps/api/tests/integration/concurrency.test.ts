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
import { getDb } from '../../src/infrastructure/database/connection.js';
import { ledgerService } from '../../src/modules/ledger/ledger.service.js';

describe('Concurrency & Race-Condition Protection (Assessment 07 & 12)', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('prevents double-spend across 10 parallel transfers from a single funded wallet', async () => {
    const alice = await registerUser({ email: 'conc-alice@fincore.test' });
    const bob = await registerUser({ email: 'conc-bob@fincore.test' });

    // Fund with ₹1,000.00 (100,000 paise); fire 10 parallel ₹300.00 (30,000 paise) transfers
    const wAlice = await createFundedWallet(alice.tokens.accessToken, alice.user.id, 100_000);
    const wBob = await createFundedWallet(bob.tokens.accessToken, bob.user.id, 0);
    const stepUpToken = await obtainStepUpToken(alice.tokens.accessToken, alice.password, 'TRANSFER');

    const requests = Array.from({ length: 10 }, () =>
      request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
        .set('X-Step-Up-Token', stepUpToken)
        .set('Idempotency-Key', randomUUID())
        .send({
          sourceWalletId: wAlice.id,
          destinationWalletId: wBob.id,
          amountMinor: 30_000,
          currency: 'INR',
        }),
    );

    const responses = await Promise.all(requests);
    const succeeded = responses.filter((r) => r.status === 201);
    const insufficient = responses.filter((r) => r.status === 422);

    expect(succeeded).toHaveLength(3);
    expect(insufficient).toHaveLength(7);

    const db = getDb();
    const aliceRow = await db('wallets').where({ id: wAlice.id }).first();
    const bobRow = await db('wallets').where({ id: wBob.id }).first();
    expect(Number(aliceRow.available_balance_minor)).toBe(10_000);
    expect(Number(bobRow.available_balance_minor)).toBe(90_000);

    const check = await ledgerService.getGlobalLedgerInvariantCheck();
    expect(check.balanced).toBe(true);
  });

  it('prevents deadlocks under bidirectional concurrent A->B and B->A transfers', async () => {
    const alice = await registerUser({ email: 'deadlock-a@fincore.test' });
    const bob = await registerUser({ email: 'deadlock-b@fincore.test' });

    const wAlice = await createFundedWallet(alice.tokens.accessToken, alice.user.id, 100_000);
    const wBob = await createFundedWallet(bob.tokens.accessToken, bob.user.id, 100_000);
    const stepA = await obtainStepUpToken(alice.tokens.accessToken, alice.password, 'TRANSFER');
    const stepB = await obtainStepUpToken(bob.tokens.accessToken, bob.password, 'TRANSFER');

    const forward = Array.from({ length: 5 }, () =>
      request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
        .set('X-Step-Up-Token', stepA)
        .set('Idempotency-Key', randomUUID())
        .send({
          sourceWalletId: wAlice.id,
          destinationWalletId: wBob.id,
          amountMinor: 10_000,
          currency: 'INR',
        }),
    );

    const reverse = Array.from({ length: 5 }, () =>
      request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${bob.tokens.accessToken}`)
        .set('X-Step-Up-Token', stepB)
        .set('Idempotency-Key', randomUUID())
        .send({
          sourceWalletId: wBob.id,
          destinationWalletId: wAlice.id,
          amountMinor: 10_000,
          currency: 'INR',
        }),
    );

    const results = await Promise.all([...forward, ...reverse]);
    expect(results.every((r) => r.status === 201)).toBe(true);

    const reconA = await ledgerService.reconcileWalletBalance(wAlice.id);
    const reconB = await ledgerService.reconcileWalletBalance(wBob.id);
    expect(reconA?.projection.ledgerBalance).toBe(100_000);
    expect(reconB?.projection.ledgerBalance).toBe(100_000);
    expect(reconA?.ledgerMatch).toBe(true);
    expect(reconB?.ledgerMatch).toBe(true);
  });

  it('deduplicates concurrent webhook deliveries using the same provider event ID', async () => {
    const alice = await registerUser({ email: 'webhook-conc@fincore.test' });
    const wAlice = await createFundedWallet(alice.tokens.accessToken, alice.user.id, 0);

    const piRes = await request(app)
      .post('/api/v1/payment-intents')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ walletId: wAlice.id, amountMinor: 50_000, currency: 'INR' });
    expect(piRes.status).toBe(201);

    const { config } = await import('../../src/config/index.js');
    const { sandboxProvider } = await import('../../src/infrastructure/providers/sandbox-provider.js');
    const { body, signature } = sandboxProvider.generateWebhookPayload(
      piRes.body.data.provider_reference,
      'payment.captured',
      50_000,
      'INR',
      config.SANDBOX_WEBHOOK_SECRET,
    );

    // Fire 5 simultaneous identical webhook HTTP calls
    const bursts = Array.from({ length: 5 }, () =>
      request(app)
        .post('/api/v1/webhooks/sandbox')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', signature)
        .send(body),
    );

    const responses = await Promise.all(bursts);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const processed = responses.filter((r) => r.body.data.status === 'processed');
    const duplicates = responses.filter((r) => r.body.data.status === 'duplicate');
    expect(processed).toHaveLength(1);
    expect(duplicates).toHaveLength(4);

    // Wallet credited ONCE
    const recon = await ledgerService.reconcileWalletBalance(wAlice.id);
    expect(recon?.projection.ledgerBalance).toBe(50_000);
  });
});
