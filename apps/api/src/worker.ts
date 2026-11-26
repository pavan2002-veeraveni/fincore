import { Queue } from 'bullmq';
import { config } from './config/index.js';
import { logger } from './infrastructure/logger/index.js';
import { closeDb, getDb } from './infrastructure/database/connection.js';
import {
  OUTBOX_QUEUE_NAME,
  createRedisConnection,
  pollPendingOutboxEvents,
  startBullMqOutboxWorker,
} from './infrastructure/queue/outbox-dispatcher.js';

const POLL_INTERVAL_MS = 5000;

async function startWorker(): Promise<void> {
  logger.info('Starting FinCore Outbox & Notification Worker...');

  // Verify DB connection
  await getDb().raw('SELECT 1');
  logger.info('Worker connected to PostgreSQL');

  let queue: Queue | null = null;
  let bullWorker: ReturnType<typeof startBullMqOutboxWorker> | null = null;
  const redis = createRedisConnection(config.REDIS_URL);
  redis.on('error', () => {
    // Suppress unhandled EventEmitter error when Redis is offline; fallback handles dispatch
  });

  try {
    await redis.connect();
    queue = new Queue(OUTBOX_QUEUE_NAME, {
      connection: redis as unknown as import('bullmq').ConnectionOptions,
    });
    bullWorker = startBullMqOutboxWorker(redis);
    logger.info('Worker connected to Redis + BullMQ');
  } catch (err) {
    try {
      redis.disconnect();
    } catch {
      // ignore
    }
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Redis unavailable — worker running in direct DB outbox fallback mode',
    );
  }

  let running = true;

  const timer = setInterval(async () => {
    if (!running) return;
    try {
      const count = await pollPendingOutboxEvents(queue);
      if (count > 0) {
        logger.info({ dispatched: count, mode: queue ? 'bullmq' : 'direct' }, 'Polled outbox events');
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Error polling outbox events');
    }
  }, POLL_INTERVAL_MS);

  async function shutdown(signal: string): Promise<void> {
    if (!running) return;
    running = false;
    logger.info(`${signal} received – draining worker...`);
    clearInterval(timer);

    if (bullWorker) await bullWorker.close();
    if (queue) await queue.close();
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
    await closeDb();
    logger.info('Worker shut down cleanly');
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startWorker().catch((err) => {
  logger.error({ err }, 'Worker failed to start');
  process.exit(1);
});
