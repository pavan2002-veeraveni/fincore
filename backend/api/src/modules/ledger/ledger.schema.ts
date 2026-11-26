import { z } from 'zod';

export const CreateJournalSchema = z.object({
  type: z.enum(['TRANSFER', 'PAYMENT', 'REFUND', 'REVERSAL', 'ADJUSTMENT', 'DEPOSIT', 'WITHDRAWAL', 'FEE']),
  currency: z.string().length(3),
  description: z.string().max(500).optional(),
  referenceId: z.string().uuid().optional(),
  referenceType: z.string().optional(),
  entries: z.array(z.object({
    walletId: z.string().uuid(),
    entryType: z.enum(['DEBIT', 'CREDIT']),
    amountMinor: z.number().int().positive('Amount must be positive'),
    description: z.string().max(500).optional(),
  })).min(2, 'At least 2 entries required'),
});
export type CreateJournalInput = z.infer<typeof CreateJournalSchema>;

export const LedgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
