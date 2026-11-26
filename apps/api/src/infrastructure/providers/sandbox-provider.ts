import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

/**
 * Sandbox Payment Provider Adapter
 *
 * Simulates a Razorpay-like payment provider for educational purposes.
 * SIMULATED — does not process real payments.
 */
export const sandboxProvider = {
  /**
   * Create a sandbox payment order/session.
   */
  createOrder(amountMinor: number, currency: string, metadata?: Record<string, unknown>) {
    const orderId = `sandbox_order_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    return {
      orderId,
      sessionUrl: `https://sandbox.fincore.test/pay/${orderId}`,
      status: 'created',
      amountMinor,
      currency,
      metadata,
      createdAt: new Date().toISOString(),
      note: 'SIMULATED — No real payment is processed',
    };
  },

  /**
   * Verify webhook signature using HMAC-SHA256 with constant-time comparison.
   */
  verifySignature(rawBody: Buffer | string, signature: string, secret: string): boolean {
    try {
      const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
      const expected = createHmac('sha256', secret).update(body).digest('hex');
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length) return false;
      return timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  },

  /**
   * Generate a signed webhook payload for testing.
   */
  generateWebhookPayload(
    orderId: string,
    eventType: string,
    amountMinor: number,
    currency: string,
    secret: string
  ) {
    const eventId = `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const payload = {
      event_id: eventId,
      event_type: eventType,
      created_at: new Date().toISOString(),
      data: { order_id: orderId, amount_minor: amountMinor, currency, status: 'paid' },
    };
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    return { payload, body, signature, eventId };
  },
};
