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

describe('Transfers, Step-Up Auth, Idempotency & Two-Step Holds (Assessment 02 & 07)', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('requires step-up confirmation and Idempotency-Key for transfers', async () => {
    const alice = await registerUser({ email: 'alice@fincore.test' });
    const bob = await registerUser({ email: 'bob@fincore.test' });

    const wAlice = await createFundedWallet(alice.tokens.accessToken, alice.user.id, 100_000);
    const wBob = await createFundedWallet(bob.tokens.accessToken, bob.user.id, 0);

    // Missing step-up token -> 403 STEP_UP_REQUIRED
    const noStepUp = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceWalletId: wAlice.id,
        destinationWalletId: wBob.id,
        amountMinor: 25_000,
        currency: 'INR',
      });
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body.error.code).toBe('STEP_UP_REQUIRED');

    const stepUpToken = await obtainStepUpToken(alice.tokens.accessToken, alice.password, 'TRANSFER');

    // Missing Idempotency-Key -> 400 VALIDATION_ERROR
    const noKey = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send({
        sourceWalletId: wAlice.id,
        destinationWalletId: wBob.id,
        amountMinor: 25_000,
        currency: 'INR',
      });
    expect(noKey.status).toBe(400);

    // Valid transfer executes atomically
    const idemKey = randomUUID();
    const ok = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .set('Idempotency-Key', idemKey)
      .send({
        sourceWalletId: wAlice.id,
        destinationWalletId: wBob.id,
        amountMinor: 25_000,
        currency: 'INR',
        description: 'Invoice payment',
      });

    expect(ok.status).toBe(201);
    expect(ok.body.data.status).toBe('COMPLETED');
    expect(ok.body.data.amountMinor).toBe(25_000);

    // Same Idempotency-Key + same payload -> returns cached 200 without second posting
    const retry = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .set('Idempotency-Key', idemKey)
      .send({
        sourceWalletId: wAlice.id,
        destinationWalletId: wBob.id,
        amountMinor: 25_000,
        currency: 'INR',
        description: 'Invoice payment',
      });

    expect(retry.status).toBe(200);
    expect(retry.body.meta.cached).toBe(true);
    expect(retry.body.data.id).toBe(ok.body.data.id);

    // Same Idempotency-Key + DIFFERENT payload -> 409 IDEMPOTENCY_KEY_REUSED
    const reuseConflict = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .set('Idempotency-Key', idemKey)
      .send({
        sourceWalletId: wAlice.id,
        destinationWalletId: wBob.id,
        amountMinor: 35_000,
        currency: 'INR',
      });

    expect(reuseConflict.status).toBe(409);
    expect(reuseConflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Balances reflect only ONE debit/credit
    const db = getDb();
    const aliceWallet = await db('wallets').where({ id: wAlice.id }).first();
    const bobWallet = await db('wallets').where({ id: wBob.id }).first();
    expect(Number(aliceWallet.available_balance_minor)).toBe(75_000);
    expect(Number(bobWallet.available_balance_minor)).toBe(25_000);
  });

  it('supports two-step transfer with hold reservation, confirm, and cancel release', async () => {
    const alice = await registerUser({ email: 'twostep-a@fincore.test' });
    const bob = await registerUser({ email: 'twostep-b@fincore.test' });
    const wAlice = await createFundedWallet(alice.tokens.accessToken, alice.user.id, 50_000);
    const wBob = await createFundedWallet(bob.tokens.accessToken, bob.user.id, 0);
    const stepUpToken = await obtainStepUpToken(alice.tokens.accessToken, alice.password, 'TRANSFER');

    // Step 1: Create two-step transfer -> PENDING_CONFIRMATION, available reduced via hold
    const created = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceWalletId: wAlice.id,
        destinationWalletId: wBob.id,
        amountMinor: 30_000,
        currency: 'INR',
        requireConfirmation: true,
      });

    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('PENDING_CONFIRMATION');

    let bal = await ledgerService.reconcileWalletBalance(wAlice.id);
    expect(bal?.projection.ledgerBalance).toBe(50_000);
    expect(bal?.projection.availableBalance).toBe(20_000);

    // Step 2: Confirm -> COMPLETED
    const confirmed = await request(app)
      .post(`/api/v1/transfers/${created.body.data.id}/confirm`)
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepUpToken);

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('COMPLETED');

    bal = await ledgerService.reconcileWalletBalance(wAlice.id);
    expect(bal?.projection.ledgerBalance).toBe(20_000);
    expect(bal?.projection.availableBalance).toBe(20_000);

    // Create another two-step transfer and cancel -> hold released!
    const created2 = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceWalletId: wAlice.id,
        destinationWalletId: wBob.id,
        amountMinor: 10_000,
        currency: 'INR',
        requireConfirmation: true,
      });
    expect(created2.status).toBe(201);

    const cancelled = await request(app)
      .post(`/api/v1/transfers/${created2.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    bal = await ledgerService.reconcileWalletBalance(wAlice.id);
    expect(bal?.projection.availableBalance).toBe(20_000);
  });
});
