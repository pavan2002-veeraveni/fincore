import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';

const isTestRateLimitBypassed = (): boolean =>
  process.env['NODE_ENV'] === 'test' && process.env['ENABLE_RATE_LIMIT_IN_TEST'] !== 'true';

function createLimiter(options: {
  windowMs: number;
  limit: number;
  message: string;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: isTestRateLimitBypassed,
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: options.message,
          requestId: req.requestId,
        },
      });
    },
  });
}

/** Strict rate limiter for auth endpoints (login, register, refresh, MFA verify). */
export const authLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  message: 'Too many authentication attempts. Please wait a minute and try again.',
});

/** Rate limiter for sensitive financial write actions. */
export const sensitiveActionLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 60,
  message: 'Rate limit exceeded for sensitive financial operations.',
});

/** Rate limiter for incoming provider webhooks. */
export const webhookLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 120,
  message: 'Webhook rate limit exceeded.',
});

/** General API baseline rate limiter. */
export const generalLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 300,
  message: 'Too many requests, please try again later.',
});
