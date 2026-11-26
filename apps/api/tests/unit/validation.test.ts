import { describe, it, expect } from 'vitest';
import { registerSchema } from '../../src/modules/auth/auth.schema.js';
import { CreateTransferSchema } from '../../src/modules/transfers/transfers.schema.js';
import { CreatePaymentIntentSchema, WebhookPayloadSchema } from '../../src/modules/payments/payments.schema.js';
import { CreateRefundSchema } from '../../src/modules/refunds/refunds.schema.js';

describe('API Boundary Zod Validation', () => {
  const walletA = '11111111-1111-4111-8111-111111111111';
  const walletB = '22222222-2222-4222-8222-222222222222';

  it('enforces strong passwords and email normalization on registration', () => {
    const valid = registerSchema.parse({
      email: '  Customer@Example.COM ',
      password: 'StrongPassword@1',
      firstName: 'Aarav',
      lastName: 'Sharma',
    });
    expect(valid.email).toBe('customer@example.com');

    expect(() =>
      registerSchema.parse({
        email: 'bad-email',
        password: 'weak',
        firstName: 'Aarav',
        lastName: 'Sharma',
      }),
    ).toThrow();
  });

  it('enforces positive integer minor units and INR currency on transfers', () => {
    expect(
      CreateTransferSchema.parse({
        sourceWalletId: walletA,
        destinationWalletId: walletB,
        amountMinor: 50000,
        currency: 'INR',
      }).amountMinor,
    ).toBe(50000);

    // Reject float amount
    expect(() =>
      CreateTransferSchema.parse({
        sourceWalletId: walletA,
        destinationWalletId: walletB,
        amountMinor: 50.25,
        currency: 'INR',
      }),
    ).toThrow();

    // Reject negative/zero amount
    expect(() =>
      CreateTransferSchema.parse({
        sourceWalletId: walletA,
        destinationWalletId: walletB,
        amountMinor: 0,
        currency: 'INR',
      }),
    ).toThrow();

    // Reject unsupported currency
    expect(() =>
      CreateTransferSchema.parse({
        sourceWalletId: walletA,
        destinationWalletId: walletB,
        amountMinor: 1000,
        currency: 'USD',
      }),
    ).toThrow();
  });

  it('enforces mutually exclusive transferId/paymentIntentId on refunds', () => {
    expect(
      CreateRefundSchema.safeParse({
        transferId: walletA,
        amountMinor: 500,
      }).success,
    ).toBe(true);

    expect(
      CreateRefundSchema.safeParse({
        transferId: walletA,
        paymentIntentId: walletB,
        amountMinor: 500,
      }).success,
    ).toBe(false);

    expect(
      CreateRefundSchema.safeParse({
        amountMinor: 500,
      }).success,
    ).toBe(false);
  });

  it('validates payment intent and webhook schemas', () => {
    expect(
      CreatePaymentIntentSchema.safeParse({
        walletId: walletA,
        amountMinor: 25000,
        currency: 'INR',
      }).success,
    ).toBe(true);

    expect(
      WebhookPayloadSchema.safeParse({
        event_id: 'evt_1',
        event_type: 'payment.captured',
        created_at: new Date().toISOString(),
        data: {
          order_id: 'sandbox_order_1',
          amount_minor: 25000,
          currency: 'INR',
          status: 'paid',
        },
      }).success,
    ).toBe(true);
  });
});
