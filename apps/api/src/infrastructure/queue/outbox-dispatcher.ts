import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { getDb } from '../database/connection.js';
import { logger } from '../logger/index.js';
import { metrics } from '../metrics/index.js';
import { notificationsService } from '../../modules/notifications/notifications.service.js';

export const OUTBOX_QUEUE_NAME = 'fincore-outbox';

interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: string;
  retry_count: number;
  max_retries: number;
  next_retry_at: Date | null;
}

/** Compute bounded exponential backoff with jitter (1s, 2s, 4s, 8s, 16s capped at 60s). */
export function computeBackoffMs(retryCount: number): number {
  const base = 1000 * Math.pow(2, Math.max(0, retryCount - 1));
  const capped = Math.min(base, 60_000);
  const jitter = Math.floor(Math.random() * 250);
  return capped + jitter;
}

/**
 * Process a single outbox event idempotently, translating domain events into
 * sandbox notifications and marking the outbox event COMPLETED or retrying/DLQ on failure.
 */
export async function processOutboxEvent(outboxId: string): Promise<void> {
  const db = getDb();

  const event = await db.transaction(async (trx) => {
    const row = await trx<OutboxRow>('outbox_events')
      .where({ id: outboxId })
      .whereIn('status', ['PENDING', 'PROCESSING'])
      .forUpdate()
      .first();

    if (!row) return null;

    if (row.status === 'PENDING') {
      await trx('outbox_events')
        .where({ id: row.id })
        .update({ status: 'PROCESSING' });
    }

    return row;
  });

  if (!event) return;

  try {
    const payload = typeof event.payload === 'string'
      ? (JSON.parse(event.payload) as Record<string, unknown>)
      : event.payload;

    // Resolve recipient user depending on aggregate/event
    let targetUserId = typeof payload['userId'] === 'string' ? payload['userId'] : undefined;

    if (!targetUserId && event.aggregate_type === 'TRANSFER') {
      const transfer = await db('transfers')
        .where({ id: event.aggregate_id })
        .select('initiated_by')
        .first<{ initiated_by: string } | undefined>();
      targetUserId = transfer?.initiated_by;
    } else if (!targetUserId && event.aggregate_type === 'PAYMENT_INTENT') {
      const intent = await db('payment_intents as pi')
        .join('customer_profiles as cp', 'pi.customer_id', 'cp.id')
        .where({ 'pi.id': event.aggregate_id })
        .select('cp.user_id')
        .first<{ user_id: string } | undefined>();
      targetUserId = intent?.user_id;
    }

    if (targetUserId) {
      const user = await db('users')
        .where({ id: targetUserId })
        .select('id', 'email', 'phone_number')
        .first<{ id: string; email: string; phone_number: string | null } | undefined>();

      if (user) {
        await notificationsService.sendSandboxNotification({
          userId: user.id,
          outboxEventId: event.id,
          channel: 'EMAIL',
          template: event.event_type,
          recipient: user.email,
          templateData: payload,
        });

        if (user.phone_number) {
          await notificationsService.sendSandboxNotification({
            userId: user.id,
            outboxEventId: event.id,
            channel: 'SMS',
            template: event.event_type,
            recipient: user.phone_number,
            templateData: payload,
          });
        }
      }
    }

    await db('outbox_events')
      .where({ id: event.id })
      .update({
        status: 'COMPLETED',
        processed_at: new Date(),
        error: null,
      });
  } catch (err) {
    metrics.counters.notificationsFailed += 1;
    const message = err instanceof Error ? err.message : 'Outbox dispatch failed';
    const nextRetry = event.retry_count + 1;
    const isTerminal = nextRetry >= event.max_retries;

    await db('outbox_events')
      .where({ id: event.id })
      .update({
        status: isTerminal ? 'FAILED' : 'PENDING',
        retry_count: nextRetry,
        next_retry_at: isTerminal ? null : new Date(Date.now() + computeBackoffMs(nextRetry)),
        error: message.slice(0, 500),
      });

    logger.error(
      { outboxId: event.id, retryCount: nextRetry, isTerminal, err: message },
      isTerminal ? 'Outbox event moved to terminal FAILED (DLQ) state' : 'Outbox event scheduled for retry',
    );
    throw err;
  }
}

/**
 * Poll PostgreSQL outbox_events for due PENDING items and either push to BullMQ
 * (if queue provided) or process directly when Redis is absent/degraded.
 */
export async function pollPendingOutboxEvents(queue?: Queue | null, batchSize = 25): Promise<number> {
  const db = getDb();

  if (queue) {
    // Claim rows atomically as PROCESSING using SKIP LOCKED so repeated polls never double-enqueue
    const claimed = await db.transaction(async (trx) => {
      const due = await trx<OutboxRow>('outbox_events')
        .where({ status: 'PENDING' })
        .andWhere((qb) => {
          qb.whereNull('next_retry_at').orWhere('next_retry_at', '<=', new Date());
        })
        .orderBy('created_at', 'asc')
        .limit(batchSize)
        .forUpdate()
        .skipLocked()
        .select('id', 'retry_count');

      if (due.length === 0) return [];
      const ids = due.map((r) => r.id);
      await trx('outbox_events')
        .whereIn('id', ids)
        .update({ status: 'PROCESSING' });
      const stampedAt = Date.now();
      return due.map((r) => ({ id: r.id, retryCount: r.retry_count, stampedAt }));
    });

    for (const row of claimed) {
      await queue.add(
        'dispatch-outbox',
        { outboxId: row.id },
        {
          // Unique per retry generation so replayed DLQ rows do not collide with retained failed jobs
          jobId: `${row.id}:${row.retryCount}:${row.stampedAt}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    }
    return claimed.length;
  }

  const rows = await db<OutboxRow>('outbox_events')
    .where({ status: 'PENDING' })
    .andWhere((qb) => {
      qb.whereNull('next_retry_at').orWhere('next_retry_at', '<=', new Date());
    })
    .orderBy('created_at', 'asc')
    .limit(batchSize)
    .select('id');

  for (const row of rows) {
    try {
      await processOutboxEvent(row.id);
    } catch {
      // Error recorded with next_retry_at in processOutboxEvent
    }
  }
  return rows.length;
}

/**
 * Replay a terminal FAILED (dead-letter) outbox event safely.
 */
export async function replayDeadLetterOutboxEvent(outboxId: string): Promise<boolean> {
  const db = getDb();
  const updated = await db('outbox_events')
    .where({ id: outboxId, status: 'FAILED' })
    .update({
      status: 'PENDING',
      retry_count: 0,
      next_retry_at: new Date(),
      error: null,
    });
  return updated > 0;
}

export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 2000,
    retryStrategy: (times) => {
      if (times > 3) return null; // Stop retrying initial startup after 3 attempts; fall back cleanly
      return Math.min(times * 300, 1500);
    },
  });
}

export function startBullMqOutboxWorker(connection: Redis): Worker<{ outboxId: string }> {
  const worker = new Worker<{ outboxId: string }>(
    OUTBOX_QUEUE_NAME,
    async (job: Job<{ outboxId: string }>) => {
      await processOutboxEvent(job.data.outboxId);
    },
    {
      connection: connection as unknown as import('bullmq').ConnectionOptions,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'BullMQ outbox job failed');
  });

  return worker;
}
