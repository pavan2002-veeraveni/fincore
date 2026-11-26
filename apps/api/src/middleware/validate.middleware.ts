// ---------------------------------------------------------------------------
// FinCore API – Zod Validation Middleware
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';
import { type ZodSchema, ZodError, z } from 'zod';
import { ValidationError } from '../shared/errors/index.js';

export const UuidParamSchema = z.object({
  id: z.string().uuid('Invalid UUID identifier'),
});

export const WalletIdParamSchema = z.object({
  walletId: z.string().uuid('Invalid wallet UUID identifier'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FieldError {
  field: string;
  message: string;
}

function formatZodError(err: ZodError): FieldError[] {
  return err.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

/**
 * Returns middleware that validates `req.body` against the provided Zod schema.
 *
 * On success the parsed (and potentially transformed) value replaces `req.body`.
 * On failure a `ValidationError` is passed to the error middleware.
 *
 * @example
 * ```ts
 * router.post('/register', validate(registerSchema), registerHandler);
 * ```
 */
export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = formatZodError(result.error);
      next(new ValidationError('Validation failed', details));
      return;
    }

    // Replace body with the parsed & transformed data
    req.body = result.data;
    next();
  };
}

// ---------------------------------------------------------------------------
// Query validation
// ---------------------------------------------------------------------------

/**
 * Returns middleware that validates `req.query` against the provided Zod schema.
 *
 * @example
 * ```ts
 * router.get('/items', validateQuery(listQuerySchema), listHandler);
 * ```
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const details = formatZodError(result.error);
      next(new ValidationError('Query validation failed', details));
      return;
    }

    // Replace query with parsed data (casted types, defaults, etc.)
    (req as any).query = result.data;
    next();
  };
}

// ---------------------------------------------------------------------------
// Params validation
// ---------------------------------------------------------------------------

/**
 * Returns middleware that validates `req.params` against the provided Zod schema.
 *
 * @example
 * ```ts
 * router.delete('/sessions/:id', validateParams(sessionIdParamSchema), handler);
 * ```
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      const details = formatZodError(result.error);
      next(new ValidationError('Path parameter validation failed', details));
      return;
    }

    (req as any).params = result.data;
    next();
  };
}
