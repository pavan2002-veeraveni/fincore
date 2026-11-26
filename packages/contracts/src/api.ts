import { z } from 'zod';

// Standard API response envelopes

export const PaginationMeta = z.object({
  requestId: z.string().uuid(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
});
export type PaginationMeta = z.infer<typeof PaginationMeta>;

export const ApiMeta = z.object({
  requestId: z.string().uuid(),
});
export type ApiMeta = z.infer<typeof ApiMeta>;

export const ApiSuccess = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    meta: ApiMeta,
  });

export const ApiPaginated = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: z.array(dataSchema),
    meta: PaginationMeta,
  });

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().uuid(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// Pagination query parameters
export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;
