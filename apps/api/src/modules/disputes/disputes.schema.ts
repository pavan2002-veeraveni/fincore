import { z } from 'zod';

export const CreateDisputeSchema = z.object({
  transferId: z.string().uuid().optional(),
  paymentIntentId: z.string().uuid().optional(),
  reason: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
});

export const AddDisputeEventSchema = z.object({
  eventType: z.enum(['STATUS_CHANGE', 'COMMENT', 'EVIDENCE', 'ASSIGNMENT']),
  comment: z.string().max(2000).optional(),
  toStatus: z
    .enum([
      'OPEN',
      'UNDER_REVIEW',
      'INFORMATION_REQUESTED',
      'RESOLVED_ACCEPTED',
      'RESOLVED_REJECTED',
      'CLOSED',
    ])
    .optional(),
  assignedTo: z.string().uuid().optional(),
});
