import { z } from 'zod';

export const CreateRefundSchema = z
  .object({
    transferId: z.string().uuid().optional(),
    paymentIntentId: z.string().uuid().optional(),
    amountMinor: z.number().int().positive('Refund amount must be positive'),
    reason: z.string().max(500).optional(),
  })
  .refine((d) => Boolean(d.transferId) !== Boolean(d.paymentIntentId), {
    message: 'Provide exactly one of transferId or paymentIntentId',
  });

export const CreateReversalSchema = z.object({
  transferId: z.string().uuid(),
  reason: z.string().min(3).max(500),
});
