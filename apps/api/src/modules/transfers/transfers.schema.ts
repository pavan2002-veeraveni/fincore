import { z } from 'zod';

export const CreateTransferSchema = z.object({
  sourceWalletId: z.string().uuid(),
  destinationWalletId: z.string().uuid(),
  amountMinor: z.number().int().positive('Amount must be positive').max(100_000_000, 'Amount exceeds single-transfer cap'),
  currency: z.enum(['INR']),
  description: z.string().max(500).optional(),
  requireConfirmation: z.boolean().default(false),
});
export type CreateTransferInput = z.infer<typeof CreateTransferSchema>;

export const TransferQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum([
      'CREATED',
      'PENDING_CONFIRMATION',
      'PROCESSING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'PARTIALLY_REFUNDED',
      'REFUNDED',
      'REVERSED',
    ])
    .optional(),
  sortBy: z.enum(['created_at', 'amount_minor', 'status']).default('created_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
