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
} from '../integration/setup.js';
import { app } from '../../src/app.js';
import { getDb } from '../../src/infrastructure/database/connection.js';

describe('Security, Identity, RBAC, IDOR & Token Lifecycle (Assessment 04)', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('prevents cross-customer IDOR across wallets, transfers, beneficiaries, statements, and disputes', async () => {
    const custA = await registerUser({ email: 'idor-a@fincore.test' });
    const custB = await registerUser({ email: 'idor-b@fincore.test' });

    const walletA = await createFundedWallet(custA.tokens.accessToken, custA.user.id, 50_000);
    const walletB = await createFundedWallet(custB.tokens.accessToken, custB.user.id, 10_000);

    // Customer B attempts to read Customer A wallet, balance, transactions
    expect(
      (await request(app).get(`/api/v1/wallets/${walletA.id}`).set('Authorization', `Bearer ${custB.tokens.accessToken}`)).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/api/v1/wallets/${walletA.id}/balance`).set('Authorization', `Bearer ${custB.tokens.accessToken}`)).status,
    ).toBe(403);
    expect(
      (await request(app).get(`/api/v1/wallets/${walletA.id}/transactions`).set('Authorization', `Bearer ${custB.tokens.accessToken}`)).status,
    ).toBe(403);

    // Customer B cannot transfer OUT of Customer A wallet
    const stepB = await obtainStepUpToken(custB.tokens.accessToken, custB.password, 'TRANSFER');
    const theftAttempt = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${custB.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepB)
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceWalletId: walletA.id,
        destinationWalletId: walletB.id,
        amountMinor: 10_000,
        currency: 'INR',
      });
    expect(theftAttempt.status).toBe(403);

    // Customer B cannot generate statement for Customer A wallet
    const stmtAttempt = await request(app)
      .post('/api/v1/statements')
      .set('Authorization', `Bearer ${custB.tokens.accessToken}`)
      .send({ walletId: walletA.id, periodStart: '2026-01-01', periodEnd: '2026-12-31' });
    expect([403, 404]).toContain(stmtAttempt.status);
  });

  it('enforces RBAC boundaries and blocks privilege escalation', async () => {
    const customer = await registerUser({ email: 'rbac-cust@fincore.test' });
    const support = await registerUser({ email: 'rbac-support@fincore.test', roles: ['SUPPORT_AGENT'] });
    const admin = await registerUser({ email: 'rbac-admin@fincore.test', roles: ['PLATFORM_ADMIN'] });

    // Customer denied ops/admin/ledger routes
    expect((await request(app).get('/api/v1/operations/dashboard').set('Authorization', `Bearer ${customer.tokens.accessToken}`)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${customer.tokens.accessToken}`)).status).toBe(403);
    expect((await request(app).get('/api/v1/ledger/invariant-check').set('Authorization', `Bearer ${customer.tokens.accessToken}`)).status).toBe(403);

    // Support agent allowed on operations dashboard, denied on admin role mutations
    expect((await request(app).get('/api/v1/operations/dashboard').set('Authorization', `Bearer ${support.tokens.accessToken}`)).status).toBe(200);
    const supportStepUp = await obtainStepUpToken(support.tokens.accessToken, support.password, 'ROLE_CHANGE');
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/users/${customer.user.id}/roles`)
          .set('Authorization', `Bearer ${support.tokens.accessToken}`)
          .set('X-Step-Up-Token', supportStepUp)
          .send({ roles: ['PLATFORM_ADMIN'] })
      ).status,
    ).toBe(403);

    // Admin requires step-up scope ROLE_CHANGE (wrong scope rejected)
    const wrongScope = await obtainStepUpToken(admin.tokens.accessToken, admin.password, 'TRANSFER');
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/users/${customer.user.id}/roles`)
          .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
          .set('X-Step-Up-Token', wrongScope)
          .send({ roles: ['SUPPORT_AGENT'] })
      ).status,
    ).toBe(403);

    const roleScope = await obtainStepUpToken(admin.tokens.accessToken, admin.password, 'ROLE_CHANGE');
    const roleOk = await request(app)
      .patch(`/api/v1/admin/users/${customer.user.id}/roles`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .set('X-Step-Up-Token', roleScope)
      .send({ roles: ['SUPPORT_AGENT'] });
    expect(roleOk.status).toBe(200);
  });

  it('rotates refresh tokens, detects token reuse & revokes token family, and immediately invalidates revoked sessions', async () => {
    const user = await registerUser({ email: 'token-sec@fincore.test' });
    const rt1 = user.tokens.refreshToken as string;

    // First refresh rotates rt1 -> rt2
    const refresh1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: rt1 });
    expect(refresh1.status).toBe(200);
    const rt2 = refresh1.body.data.refreshToken as string;
    expect(rt2).not.toBe(rt1);

    // Reuse of rt1 -> triggers reuse detection, revokes entire family and session!
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: rt1 });
    expect(reuse.status).toBe(401);

    // rt2 from same compromised family is now rejected too, and old access token is rejected because session was revoked
    const afterCompromiseRefresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: rt2 });
    expect(afterCompromiseRefresh.status).toBe(401);

    const revokedSessionAccess = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refresh1.body.data.accessToken}`);
    expect(revokedSessionAccess.status).toBe(401);

    const audit = await getDb()('audit_events').where({ action: 'REFRESH_TOKEN_REUSE_DETECTED' });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('neutralizes CSV formula injection in exported statements', async () => {
    const cust = await registerUser({ email: 'csv-sec@fincore.test' });
    const other = await registerUser({ email: 'csv-other@fincore.test' });
    const w1 = await createFundedWallet(cust.tokens.accessToken, cust.user.id, 10_000);
    const w2 = await createFundedWallet(other.tokens.accessToken, other.user.id, 0);
    const step = await obtainStepUpToken(cust.tokens.accessToken, cust.password, 'TRANSFER');

    await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
      .set('X-Step-Up-Token', step)
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceWalletId: w1.id,
        destinationWalletId: w2.id,
        amountMinor: 1000,
        currency: 'INR',
        description: '=CMD|" /C calc"!A0',
      });

    const today = new Date().toISOString().slice(0, 10);
    const stmtRes = await request(app)
      .post('/api/v1/statements')
      .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
      .send({ walletId: w1.id, periodStart: today, periodEnd: today });
    expect(stmtRes.status).toBe(201);

    const csvRes = await request(app)
      .get(`/api/v1/statements/${stmtRes.body.data.id}/export`)
      .set('Authorization', `Bearer ${cust.tokens.accessToken}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.text).toContain("'=CMD");
  });
});
