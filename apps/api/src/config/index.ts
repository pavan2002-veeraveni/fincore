import { z } from 'zod';
import { loadLocalEnvFile } from './load-env.js';

loadLocalEnvFile();

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid URL' }),
  REDIS_URL: z.string().url({ message: 'REDIS_URL must be a valid URL' }),
  ACCESS_TOKEN_SECRET: z
    .string()
    .min(16, 'ACCESS_TOKEN_SECRET must be at least 16 characters'),
  REFRESH_TOKEN_SECRET: z
    .string()
    .min(16, 'REFRESH_TOKEN_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_EXPIRY: z
    .string()
    .min(1, 'ACCESS_TOKEN_EXPIRY is required'),
  REFRESH_TOKEN_EXPIRY: z
    .string()
    .min(1, 'REFRESH_TOKEN_EXPIRY is required'),
  RISK_SERVICE_URL: z
    .string()
    .url({ message: 'RISK_SERVICE_URL must be a valid URL' }),
  RISK_SERVICE_TOKEN: z
    .string()
    .min(1, 'RISK_SERVICE_TOKEN is required'),
  SANDBOX_WEBHOOK_SECRET: z
    .string()
    .min(12, 'SANDBOX_WEBHOOK_SECRET must be at least 12 characters'),
  WEB_ORIGIN: z
    .string()
    .url({ message: 'WEB_ORIGIN must be a valid URL' }),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `\n❌ Invalid environment variables:\n${formatted}\n\nPlease check your .env file or environment configuration.\n`,
    );
  }

  return result.data;
}

export const config = validateEnv();

export type Config = typeof config;
