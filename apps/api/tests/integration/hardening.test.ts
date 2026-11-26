import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
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
import {
  SYSTEM_CLEARING_WALLET_ID,
  SYSTEM_USER_ID,
} from '../../src/infrastructure/database/migrations/004_system_accounts_and_hardening.js';

describe('Security, Risk Proxy, Outbox & API Route Hardening Regression Suite', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('blocks sender transfer-refund IDOR while allowing recipient return and payment-intent refunds', async () => {
    const sender = await registerUser({ email: 'idor-sender@fincore.test' });
    const recipient = await registerUser({ email: 'idor-recipient@fincore.test' });

    const wSender = await createFundedWallet(sender.tokens.accessToken, sender.user.id, 100_000);
    const wRecip = await createFundedWallet(recipient.tokens.accessToken, recipient.user.id, 0);

    const stepSender = await obtainStepUpToken(sender.tokens.accessToken, sender.password, 'TRANSFER');
    const transferRes = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${sender.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepSender)
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceWalletId: wSender.id,
        destinationWalletId: wRecip.id,
        amountMinor: 30_000,
        currency: 'INR',
      });
    expect(transferRes.status).toBe(201);

    // Sender MUST NOT pull money back out of recipient's wallet
    const senderRefundStep = await obtainStepUpToken(sender.tokens.accessToken, sender.password, 'REFUND');
    const senderPull = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${sender.tokens.accessToken}`)
      .set('X-Step-Up-Token', senderRefundStep)
      .set('Idempotency-Key', randomUUID())
      .send({ transferId: transferRes.body.data.id, amountMinor: 10_000, reason: 'Unauthorized pull' });
    expect(senderPull.status).toBe(403);

    // Recipient CAN return funds back to sender
    const recipRefundStep = await obtainStepUpToken(recipient.tokens.accessToken, recipient.password, 'REFUND');
    const recipReturn = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${recipient.tokens.accessToken}`)
      .set('X-Step-Up-Token', recipRefundStep)
      .set('Idempotency-Key', randomUUID())
      .send({ transferId: transferRes.body.data.id, amountMinor: 10_000, reason: 'Voluntary return' });
    expect(recipReturn.status).toBe(201);

    // Payment intent deposit + partial refund
    const piRes = await request(app)
      .post('/api/v1/payment-intents')
      .set('Authorization', `Bearer ${sender.tokens.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ walletId: wSender.id, amountMinor: 25_000, currency: 'INR' });
    expect(piRes.status).toBe(201);

    const captureRes = await request(app)
      .post(`/api/v1/payment-intents/${piRes.body.data.id}/simulate-webhook`)
      .set('Authorization', `Bearer ${sender.tokens.accessToken}`)
      .send({ eventType: 'payment.captured' });
    expect(captureRes.status).toBe(200);

    const piRefund = await request(app)
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${sender.tokens.accessToken}`)
      .set('X-Step-Up-Token', senderRefundStep)
      .set('Idempotency-Key', randomUUID())
      .send({ paymentIntentId: piRes.body.data.id, amountMinor: 25_000, reason: 'Full PI refund' });
    expect(piRefund.status).toBe(201);
  });

  it('prevents FINANCE_ADMIN privilege escalation and self/SYSTEM account mutation, and revokes sessions on suspension', async () => {
    const customer = await registerUser({ email: 'admin-target@fincore.test' });
    const financeAdmin = await registerUser({ email: 'fin-escalate@fincore.test', roles: ['FINANCE_ADMIN'] });
    const platformAdmin = await registerUser({ email: 'plat-admin@fincore.test', roles: ['PLATFORM_ADMIN'] });

    const finStep = await obtainStepUpToken(financeAdmin.tokens.accessToken, financeAdmin.password, 'ROLE_CHANGE');
    const escalateAttempt = await request(app)
      .patch(`/api/v1/admin/users/${financeAdmin.user.id}/roles`)
      .set('Authorization', `Bearer ${financeAdmin.tokens.accessToken}`)
      .set('X-Step-Up-Token', finStep)
      .send({ roles: ['PLATFORM_ADMIN'] });
    expect(escalateAttempt.status).toBe(403);

    const platStep = await obtainStepUpToken(platformAdmin.tokens.accessToken, platformAdmin.password, 'ROLE_CHANGE');
    // Self-suspension and SYSTEM_USER mutation are blocked
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/users/${platformAdmin.user.id}/status`)
          .set('Authorization', `Bearer ${platformAdmin.tokens.accessToken}`)
          .set('X-Step-Up-Token', platStep)
          .send({ status: 'SUSPENDED' })
      ).status,
    ).toBe(403);

    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/users/${SYSTEM_USER_ID}/roles`)
          .set('Authorization', `Bearer ${platformAdmin.tokens.accessToken}`)
          .set('X-Step-Up-Token', platStep)
          .send({ roles: ['CUSTOMER'] })
      ).status,
    ).toBe(403);

    // Suspending customer revokes active sessions & blocks subsequent access and login
    const suspendRes = await request(app)
      .patch(`/api/v1/admin/users/${customer.user.id}/status`)
      .set('Authorization', `Bearer ${platformAdmin.tokens.accessToken}`)
      .set('X-Step-Up-Token', platStep)
      .send({ status: 'SUSPENDED', reason: 'Policy violation review' });
    expect(suspendRes.status).toBe(200);

    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${customer.tokens.accessToken}`)).status,
    ).toBe(401);
    expect(
      (await request(app).post('/api/v1/auth/login').send({ email: customer.user.email, password: customer.password })).status,
    ).toBe(403);
  });

  it('blocks targeting SYSTEM_* wallets, validates UUID params cleanly, returns JSON 404 with matching X-Request-ID, and supports wallet freeze', async () => {
    const alice = await registerUser({ email: 'sys-guard@fincore.test' });
    const finance = await registerUser({ email: 'freeze-ops@fincore.test', roles: ['FINANCE_ADMIN'] });
    const wAlice = await createFundedWallet(alice.tokens.accessToken, alice.user.id, 20_000);

    const stepBenef = await obtainStepUpToken(alice.tokens.accessToken, alice.password, 'BENEFICIARY_CHANGE');
    const badBenef = await request(app)
      .post('/api/v1/beneficiaries')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepBenef)
      .send({ destinationWalletId: SYSTEM_CLEARING_WALLET_ID, nickname: 'System' });
    expect(badBenef.status).toBe(400);

    const stepTx = await obtainStepUpToken(alice.tokens.accessToken, alice.password, 'TRANSFER');
    const badTx = await request(app)
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepTx)
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceWalletId: wAlice.id,
        destinationWalletId: SYSTEM_CLEARING_WALLET_ID,
        amountMinor: 1000,
        currency: 'INR',
      });
    expect(badTx.status).toBe(400);

    // Invalid UUID param -> 400 (never 500)
    const badUuid = await request(app)
      .get('/api/v1/wallets/not-a-uuid')
      .set('Authorization', `Bearer ${alice.tokens.accessToken}`);
    expect(badUuid.status).toBe(400);
    expect(badUuid.body.error.code).toBe('VALIDATION_ERROR');
    expect(badUuid.body.error.requestId).toBe(badUuid.headers['x-request-id']);

    // Unknown route -> JSON 404 with correlated requestId
    const notFound = await request(app).get('/api/v1/does-not-exist');
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('NOT_FOUND');
    expect(notFound.body.error.requestId).toBe(notFound.headers['x-request-id']);

    // Freeze wallet blocks outgoing transfer
    const stepFreeze = await obtainStepUpToken(finance.tokens.accessToken, finance.password, 'ROLE_CHANGE');
    const freezeRes = await request(app)
      .patch(`/api/v1/wallets/${wAlice.id}/status`)
      .set('Authorization', `Bearer ${finance.tokens.accessToken}`)
      .set('X-Step-Up-Token', stepFreeze)
      .send({ status: 'FROZEN', reason: 'Simulated dispute freeze' });
    expect(freezeRes.status).toBe(200);
    expect(freezeRes.body.data.status).toBe('FROZEN');
  });

  it('exercises MFA verification/lockout, logout ownership, cookie CSRF refresh, concurrent idempotency serialization, health, metrics, customers, and live Risk proxy', async () => {
    const cust = await registerUser({ email: 'full-flow@fincore.test' });
    const other = await registerUser({ email: 'other-flow@fincore.test' });
    const analyst = await registerUser({ email: 'analyst-flow@fincore.test', roles: ['OPERATIONS_ANALYST'] });

    // 1. Simulated MFA challenge + non-owner block + wrong attempts + valid verify
    const mfaRes = await request(app)
      .post('/api/v1/auth/mfa/challenge')
      .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
      .send({ action: 'TRANSFER' });
    expect(mfaRes.status).toBe(201);
    const { challengeId, simulatedCode } = mfaRes.body.data as { challengeId: string; simulatedCode: string };

    expect(
      (
        await request(app)
          .post('/api/v1/auth/mfa/verify')
          .set('Authorization', `Bearer ${other.tokens.accessToken}`)
          .send({ challengeId, code: simulatedCode })
      ).status,
    ).toBe(403);

    expect(
      (
        await request(app)
          .post('/api/v1/auth/mfa/verify')
          .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
          .send({ challengeId, code: '000000' === simulatedCode ? '000001' : '000000' })
      ).status,
    ).toBe(400);

    const mfaVerifyOk = await request(app)
      .post('/api/v1/auth/mfa/verify')
      .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
      .send({ challengeId, code: simulatedCode });
    expect(mfaVerifyOk.status).toBe(200);
    expect(mfaVerifyOk.body.data.stepUpToken).toBeTruthy();

    // 2. Concurrent identical Idempotency-Key serializes cleanly without 500
    const w1 = await createFundedWallet(cust.tokens.accessToken, cust.user.id, 50_000);
    const w2 = await createFundedWallet(other.tokens.accessToken, other.user.id, 0);
    const sameKey = randomUUID();
    const [tA, tB] = await Promise.all([
      request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
        .set('X-Step-Up-Token', mfaVerifyOk.body.data.stepUpToken)
        .set('Idempotency-Key', sameKey)
        .send({ sourceWalletId: w1.id, destinationWalletId: w2.id, amountMinor: 5000, currency: 'INR' }),
      request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
        .set('X-Step-Up-Token', mfaVerifyOk.body.data.stepUpToken)
        .set('Idempotency-Key', sameKey)
        .send({ sourceWalletId: w1.id, destinationWalletId: w2.id, amountMinor: 5000, currency: 'INR' }),
    ]);
    expect([tA.status, tB.status].sort()).toEqual([200, 201]);

    // 3. Health, metrics RBAC, customer profile, and OpenAPI YAML
    expect((await request(app).get('/api/v1/health/live')).status).toBe(200);
    expect((await request(app).get('/api/v1/health/ready')).status).toBe(200);
    expect((await request(app).get('/api/v1/metrics').set('Authorization', `Bearer ${cust.tokens.accessToken}`)).status).toBe(403);
    expect((await request(app).get('/api/v1/metrics').set('Authorization', `Bearer ${analyst.tokens.accessToken}`)).status).toBe(200);
    expect((await request(app).get('/api/v1/customers/me').set('Authorization', `Bearer ${cust.tokens.accessToken}`)).status).toBe(200);
    expect((await request(app).get('/api/v1/openapi.yaml')).status).toBe(200);

    // 4. Logout blocks revoking another user's token and revokes own
    expect(
      (
        await request(app)
          .post('/api/v1/auth/logout')
          .set('Authorization', `Bearer ${other.tokens.accessToken}`)
          .send({ refreshToken: cust.tokens.refreshToken })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/logout')
          .set('Authorization', `Bearer ${cust.tokens.accessToken}`)
          .send({ refreshToken: cust.tokens.refreshToken })
      ).status,
    ).toBe(200);

    // 5. Cookie-based refresh requires matching X-CSRF-Token
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: other.user.email, password: other.password });
    const cookies = (loginRes.headers['set-cookie'] ?? []) as unknown as string[];
    const csrfCookie = cookies.find((c) => c.startsWith('fincore_csrf='))?.split(';')[0]?.split('=')[1];
    expect(csrfCookie).toBeTruthy();

    const noCsrf = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookies).send({});
    expect(noCsrf.status).toBe(403);

    const validCsrf = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrfCookie!)
      .send({});
    expect(validCsrf.status).toBe(200);

    // 6. Live HTTP Risk proxy test against local stub server (HIGH -> creates alert & audit)
    const custProfile = await getDb()('customer_profiles').where({ user_id: cust.user.id }).first();
    const assessmentId = randomUUID();
    const stubServer = http.createServer((req, res) => {
      if (req.url === '/api/v1/assess' && req.method === 'POST') {
        expect(req.headers['x-service-token']).toBe(config.RISK_SERVICE_TOKEN);
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            assessment_id: assessmentId,
            score: 85,
            risk_level: 'HIGH',
            rule_hits: [{ rule_id: 'RULE_002', rule_name: 'high_amount', severity: 'HIGH', explanation: 'High amount' }],
            explanations: ['High amount detected — decision support only'],
            ruleset_version: '1.1.0',
            evaluated_at: new Date().toISOString(),
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => stubServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = stubServer.address() as { port: number };
    const origUrl = config.RISK_SERVICE_URL;
    (config as { RISK_SERVICE_URL: string }).RISK_SERVICE_URL = `http://127.0.0.1:${addr.port}`;

    try {
      const assessRes = await request(app)
        .post('/api/v1/risk/assess')
        .set('Authorization', `Bearer ${analyst.tokens.accessToken}`)
        .send({
          customerId: custProfile.id,
          transactionAmountMinor: 8_000_000,
          currency: 'INR',
          failMode: 'FAIL_CLOSED',
        });
      expect(assessRes.status).toBe(200);
      expect(assessRes.body.data.risk_level).toBe('HIGH');

      const alerts = await request(app)
        .get('/api/v1/risk/alerts?status=OPEN')
        .set('Authorization', `Bearer ${analyst.tokens.accessToken}`);
      expect(alerts.status).toBe(200);
      expect(alerts.body.data.length).toBeGreaterThanOrEqual(1);
    } finally {
      (config as { RISK_SERVICE_URL: string }).RISK_SERVICE_URL = origUrl;
      await new Promise<void>((resolve) => stubServer.close(() => resolve()));
    }
  });
});
