import { createHash } from 'node:crypto';
import { type Knex } from 'knex';

/**
 * Compute a deterministic SHA-256 hash of the request body for idempotency checks.
 * Keys are sorted to ensure consistency regardless of property order.
 */
export function computeRequestHash(body: Record<string, unknown>): string {
  const sorted = JSON.stringify(body, Object.keys(body).sort());
  return createHash('sha256').update(sorted).digest('hex');
}

export interface IdempotencyRecord {
  id: string;
  user_id: string;
  idempotency_key: string;
  request_hash: string;
  operation: string;
  resource_id: string | null;
  resource_type: string | null;
  status_code: number | null;
  response_body: unknown;
  created_at: Date;
  expires_at: Date;
}

/**
 * Acquire a transaction-scoped advisory lock for `(userId, idempotencyKey)` so
 * simultaneous retries with an identical new key serialize cleanly instead of
 * failing on duplicate insert `23505`.
 */
export async function lockIdempotencyScope(
  trx: Knex,
  userId: string,
  key: string,
): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`${userId}:${key}`]);
}

/**
 * Check if an idempotency record exists for this user + key.
 * Returns the existing record or null.
 */
export async function checkIdempotency(
  trx: Knex,
  userId: string,
  key: string
): Promise<IdempotencyRecord | null> {
  const record = await trx('idempotency_records')
    .where({ user_id: userId, idempotency_key: key })
    .where('expires_at', '>', new Date())
    .first();
  return record as IdempotencyRecord | null;
}

/**
 * Save an idempotency record. TTL defaults to 24 hours.
 */
export async function saveIdempotencyRecord(
  trx: Knex,
  data: {
    userId: string;
    idempotencyKey: string;
    requestHash: string;
    operation: string;
    resourceId?: string;
    resourceType?: string;
    statusCode?: number;
    responseBody?: unknown;
  }
): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await trx('idempotency_records').insert({
    user_id: data.userId,
    idempotency_key: data.idempotencyKey,
    request_hash: data.requestHash,
    operation: data.operation,
    resource_id: data.resourceId || null,
    resource_type: data.resourceType || null,
    status_code: data.statusCode || null,
    response_body: data.responseBody ? JSON.stringify(data.responseBody) : null,
    expires_at: expiresAt,
  });
}
