import { z } from 'zod';

export const CreateBeneficiarySchema = z.object({
  destinationWalletId: z.string().uuid(),
  nickname: z.string().min(1).max(100),
});

export const UpdateBeneficiarySchema = z.object({
  nickname: z.string().min(1).max(100).optional(),
});
