// ============================================================================
// RecallForge — Environment Configuration
// ============================================================================
// Validates and exposes all environment variables. Fails fast at startup if
// required variables are missing. Import this module early in server code.
// ============================================================================

import { z } from 'zod';

const envSchema = z.object({
  // ── Auth ──────────────────────────────────────────────────────────────
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  AUTH_TRUST_HOST: z.string().default('true'),

  // ── Database ─────────────────────────────────────────────────────────
  DATABASE_PATH: z.string().default('data/recallforge.db'),

  // ── App ──────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('3030'),
  BASE_URL: z.string().url().optional(),

  // ── Rate Limiting ────────────────────────────────────────────────────
  RATE_LIMIT_AUTH_MAX: z.string().default('20'),
  RATE_LIMIT_API_MAX: z.string().default('120'),
  RATE_LIMIT_WINDOW_MS: z.string().default('60000'),

  // ── Logging ──────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ── Sync ─────────────────────────────────────────────────────────────
  SYNC_MAX_BATCH_SIZE: z.string().default('50'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

/**
 * Parse and validate environment variables. Caches the result.
 * Throws at startup if required vars are missing.
 */
export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // In production, don't expose variable names in HTTP responses
    // but DO log them to stderr for operator visibility
    console.error(
      `\n❌ RecallForge — Invalid environment configuration:\n${errors}\n`
    );
    throw new Error('Invalid environment configuration. Check server logs.');
  }

  _env = result.data;
  return _env;
}

/** Check if running in production */
export function isProd(): boolean {
  return getEnv().NODE_ENV === 'production';
}

/** Check if running in test */
export function isTest(): boolean {
  return getEnv().NODE_ENV === 'test';
}

/** Resolved base URL (explicit or inferred from PORT) */
export function getBaseUrl(): string {
  const env = getEnv();
  if (env.BASE_URL) return env.BASE_URL;
  return `http://localhost:${env.PORT}`;
}

/** Reset cached env (for tests) */
export function _resetEnv(): void {
  _env = null;
}
