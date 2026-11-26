import { z } from 'zod';

export const CreateReconciliationRunSchema = z.object({
  providerName: z.string().min(1).max(50).default('sandbox'),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  providerData: z.array(
    z.object({
      reference: z.string().min(1),
      amount_minor: z.number().int().nonnegative(),
      currency: z.string().length(3),
      timestamp: z.string().min(1),
    }),
  ),
});

export const ResolveExceptionSchema = z.object({
  notes: z.string().min(3).max(2000),
  status: z.enum(['RESOLVED', 'DISMISSED']).default('RESOLVED'),
});

export const ReconciliationExceptionQuerySchema = z.object({
  runId: z.string().uuid().optional(),
  status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
