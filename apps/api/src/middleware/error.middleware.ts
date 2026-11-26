// ---------------------------------------------------------------------------
// FinCore API – Central Error-Handling Middleware
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors/index.js';
import { logger } from '../infrastructure/logger/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorResponseBody {
  error: {
    /** Machine-readable error code. */
    code: string;
    /** Human-readable summary safe for clients. */
    message: string;
    /** Optional structured details (e.g. per-field validation errors). */
    details?: unknown;
    /** Correlation ID for support / log lookups. */
    requestId: string | undefined;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pull (or generate) a request ID.
 *
 * Most setups attach one via an upstream middleware or reverse proxy header
 * (`x-request-id`). Fall back to a simple random id when none is present.
 */
function getRequestId(req: Request): string {
  if (req.requestId && req.requestId.trim()) {
    return req.requestId;
  }
  const headerId = req.headers['x-request-id'];
  return (typeof headerId === 'string' && headerId.trim() ? headerId.trim() : randomUUID());
}

/**
 * Build the sanitised client-facing envelope.
 */
function buildEnvelope(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorResponseBody {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details !== undefined && { details }),
    },
  };
}

// ---------------------------------------------------------------------------
// Zod helpers
// ---------------------------------------------------------------------------

interface FieldError {
  field: string;
  message: string;
}

function formatZodIssues(err: ZodError): FieldError[] {
  return err.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Express error-handling middleware.
 *
 * Must be registered **after** all route handlers:
 *
 * ```ts
 * app.use(errorMiddleware);
 * ```
 */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = getRequestId(req);

  // ------------------------------------------------------------------
  // 1. Known application errors
  // ------------------------------------------------------------------
  if (err instanceof AppError) {
    logger.warn(
      {
        requestId,
        code: err.code,
        statusCode: err.statusCode,
        message: err.message,
      },
      'Application error handled',
    );

    res
      .status(err.statusCode)
      .json(buildEnvelope(err.code, err.message, requestId, err.details));
    return;
  }

  // ------------------------------------------------------------------
  // 2. Zod validation errors
  // ------------------------------------------------------------------
  if (err instanceof ZodError) {
    const details = formatZodIssues(err);

    logger.warn(
      {
        requestId,
        code: 'VALIDATION_ERROR',
        issueCount: details.length,
      },
      'Zod validation error handled',
    );

    res
      .status(400)
      .json(buildEnvelope('VALIDATION_ERROR', 'Validation failed', requestId, details));
    return;
  }

  // ------------------------------------------------------------------
  // 3. Malformed JSON body
  // ------------------------------------------------------------------
  if (err instanceof SyntaxError && 'body' in err) {
    logger.warn(
      {
        requestId,
        code: 'INVALID_JSON',
      },
      'Malformed JSON request body',
    );

    res
      .status(400)
      .json(buildEnvelope('INVALID_JSON', 'Malformed JSON in request body', requestId));
    return;
  }

  // ------------------------------------------------------------------
  // 3b. PostgreSQL constraint/input errors (mapped safely without SQL leakage)
  // ------------------------------------------------------------------
  const pgCode = typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
  if (pgCode === '22P02') {
    logger.warn({ requestId, pgCode }, 'Invalid PostgreSQL syntax/UUID parameter rejected');
    res
      .status(400)
      .json(buildEnvelope('VALIDATION_ERROR', 'Invalid identifier or parameter format', requestId));
    return;
  }
  if (pgCode === '23505') {
    logger.warn({ requestId, pgCode }, 'Unique constraint conflict mapped to 409');
    res
      .status(409)
      .json(buildEnvelope('CONFLICT', 'Resource conflict — duplicate key or concurrent submission', requestId));
    return;
  }

  // ------------------------------------------------------------------
  // 4. Everything else → opaque 500
  //    NEVER leak stack traces, SQL errors, or internal paths.
  // ------------------------------------------------------------------
  const internalMessage =
    err instanceof Error ? err.message : String(err);

  logger.error(
    {
      requestId,
      code: 'INTERNAL_ERROR',
      message: internalMessage,
    },
    'Unhandled server error',
  );

  res
    .status(500)
    .json(
      buildEnvelope(
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        requestId,
      ),
    );
}
