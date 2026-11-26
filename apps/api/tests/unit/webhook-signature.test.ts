import { describe, it, expect } from 'vitest';
import { sandboxProvider } from '../../src/infrastructure/providers/sandbox-provider.js';
import { computeRequestHash } from '../../src/shared/security/idempotency.js';
import { computeBackoffMs } from '../../src/infrastructure/queue/outbox-dispatcher.js';

describe('Webhook Signature, Idempotency Hashing & Retry Backoff', () => {
  const secret = 'test_webhook_secret_key';

  it('verifies valid HMAC-SHA256 webhook signature over raw body', () => {
    const order = sandboxProvider.createOrder(100000, 'INR');
    const { body, signature } = sandboxProvider.generateWebhookPayload(
      order.orderId,
      'payment.captured',
      100000,
      'INR',
      secret,
    );

    expect(sandboxProvider.verifySignature(Buffer.from(body, 'utf-8'), signature, secret)).toBe(true);
  });

  it('rejects tampered payload, bad hex, or wrong secret', () => {
    const { body, signature } = sandboxProvider.generateWebhookPayload(
      'sandbox_order_123',
      'payment.captured',
      50000,
      'INR',
      secret,
    );

    const tamperedBody = body.replace('50000', '999999');
    expect(sandboxProvider.verifySignature(Buffer.from(tamperedBody, 'utf-8'), signature, secret)).toBe(false);
    expect(sandboxProvider.verifySignature(Buffer.from(body, 'utf-8'), signature, 'wrong_secret')).toBe(false);
    expect(sandboxProvider.verifySignature(Buffer.from(body, 'utf-8'), 'deadbeef', secret)).toBe(false);
    expect(sandboxProvider.verifySignature(Buffer.from(body, 'utf-8'), '', secret)).toBe(false);
  });

  it('produces identical SHA-256 request fingerprints regardless of key order', () => {
    const hashA = computeRequestHash({
      amountMinor: 1000,
      currency: 'INR',
      sourceWalletId: 'a',
      destinationWalletId: 'b',
    });
    const hashB = computeRequestHash({
      destinationWalletId: 'b',
      sourceWalletId: 'a',
      currency: 'INR',
      amountMinor: 1000,
    });
    const hashDiff = computeRequestHash({
      amountMinor: 2000,
      currency: 'INR',
      sourceWalletId: 'a',
      destinationWalletId: 'b',
    });

    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashDiff);
  });

  it('computes bounded exponential backoff with jitter for queue retries', () => {
    const r1 = computeBackoffMs(1);
    const r2 = computeBackoffMs(2);
    const r3 = computeBackoffMs(3);
    const r20 = computeBackoffMs(20);

    expect(r1).toBeGreaterThanOrEqual(1000);
    expect(r1).toBeLessThan(1300);
    expect(r2).toBeGreaterThanOrEqual(2000);
    expect(r3).toBeGreaterThanOrEqual(4000);
    expect(r20).toBeLessThanOrEqual(60250);
  });
});
