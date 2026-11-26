import { z } from 'zod';

export const CreateWalletSchema = z.object({
  walletName: z.string().min(1).max(100).default('Primary Wallet'),
  currency: z.enum(['INR']).default('INR'),
});

export const WalletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['ACTIVE', 'FROZEN', 'CLOSED']).optional(),
  customerId: z.string().uuid().optional(),
});

export const UpdateWalletStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'FROZEN', 'CLOSED']),
  reason: z.string().min(3).max(500).optional(),
});
