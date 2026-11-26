import pino, { type Logger, type LoggerOptions } from 'pino';
import { randomUUID } from 'node:crypto';

const LOG_LEVEL = process.env['LOG_LEVEL'] ?? 'info';
const NODE_ENV = process.env['NODE_ENV'] ?? 'production';
const isDevelopment = NODE_ENV === 'development';

/** Keys whose values must never appear in logs. */
const REDACTED_PATHS = [
  'password',
  'newPassword',
  'oldPassword',
  'confirmPassword',
  '*.password',
  'token',
  'accessToken',
  'refreshToken',
  'stepUpToken',
  'idToken',
  '*.token',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'code',
  'simulatedCode',
  'email',
  'phoneNumber',
  'addressLine1',
  'creditCard',
  'ssn',
  'socialSecurityNumber',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-step-up-token"]',
  'req.headers["x-webhook-signature"]',
  'req.headers["x-service-token"]',
];

const baseOptions: LoggerOptions = {
  level: LOG_LEVEL,

  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },

  formatters: {
    level(label) {
      return { level: label };
    },
  },

  timestamp: pino.stdTimeFunctions.isoTime,

  base: {
    service: 'fincore-api',
  },

  // Attach a request ID to every log entry by default.
  // Callers can override per-request via `logger.child({ requestId })`.
  mixin() {
    return { requestId: randomUUID() };
  },
};

/**
 * Build the pino transport.
 *
 * In development we pipe through pino-pretty for human-readable output.
 * In production we emit newline-delimited JSON (pino default).
 */
function buildTransport(): LoggerOptions['transport'] {
  if (isDevelopment) {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }
  return undefined;
}

/**
 * Create a child logger scoped to a specific module.
 *
 * @example
 * ```ts
 * const log = createLogger('UserService');
 * log.info({ userId: 42 }, 'user created');
 * ```
 */
export function createLogger(module: string): Logger {
  return logger.child({ module });
}

/** Root logger instance for the fincore-api service. */
export const logger: Logger = pino({
  ...baseOptions,
  transport: buildTransport(),
});

export default logger;
