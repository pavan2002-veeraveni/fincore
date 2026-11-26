import type { Request } from 'express';
import { ValidationError } from '../errors/index.js';

/** Safely extract a route parameter as a single string (handles @types/express v5 string | string[]). */
export function getParam(req: Request, key: string): string {
  const val = req.params[key];
  if (Array.isArray(val)) {
    const first = val[0];
    if (!first) throw new ValidationError(`Missing route parameter: ${key}`);
    return first;
  }
  if (!val) {
    throw new ValidationError(`Missing route parameter: ${key}`);
  }
  return val;
}

/** Extract single string query param cleanly. */
export function getQueryString(req: Request, key: string): string | undefined {
  const val = req.query[key];
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
}

/** Extract Knex count() result safely regardless of pg row typing. */
export function parseCount(rows: unknown, field = 'count'): number {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const row = rows[0] as Record<string, unknown> | undefined;
  return Number(row?.[field] ?? 0);
}

/** Standard API success envelope. */
export function envelope<T>(data: T, requestId: string, extraMeta?: Record<string, unknown>) {
  return {
    data,
    meta: {
      requestId,
      ...extraMeta,
    },
  };
}

/** Standard API paginated envelope. */
export function paginatedEnvelope<T>(
  data: T[],
  requestId: string,
  page: number,
  pageSize: number,
  total: number,
) {
  return {
    data,
    meta: {
      requestId,
      page,
      pageSize,
      total,
    },
  };
}
