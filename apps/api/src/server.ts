import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './infrastructure/logger/index.js';
import { closeDb } from './infrastructure/database/connection.js';

const server = app.listen(config.PORT, () => {
  logger.info(`FinCore API server listening on port ${config.PORT} [${config.NODE_ENV}]`);
});

// Graceful shutdown handler
function shutdown(signal: string): void {
  logger.info(`${signal} received – shutting down gracefully…`);
  server.close(async () => {
    logger.info('HTTP server closed');
    await closeDb();
    logger.info('Database connections closed');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('Graceful shutdown timed out – forcing exit');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ err: reason }, 'Unhandled Rejection');
});

process.on('uncaughtException', (error: Error) => {
  logger.error({ err: error }, 'Uncaught Exception');
  shutdown('uncaughtException');
});
