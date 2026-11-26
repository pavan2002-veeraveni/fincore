import { z } from 'zod';

export const CreatePaymentIntentSchema = z.object({
  walletId: z.string().uuid(),
  amountMinor: z.number().int().positive('Amount must be positive').max(100_000_000),
  currency: z.enum(['INR']),
  description: z.string().max(500).optional(),
});

export const SimulatePaymentWebhookSchema = z.object({
  eventType: z.enum(['payment.captured', 'payment.failed']).default('payment.captured'),
  overrideAmountMinor: z.number().int().positive().optional(),
});

export const WebhookPayloadSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  created_at: z.string().min(1),
  data: z.object({
    order_id: z.string().min(1),
    amount_minor: z.number().int().nonnegative(),
    currency: z.string().length(3),
    status: z.string(),
  }),
});
