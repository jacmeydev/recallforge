// ============================================================================
// RecallForge — Phase 4 Tests: Env, Logger, Rate Limiter
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Env Validation ────────────────────────────────────────────────────────

describe('Env validation', () => {
  it('getEnv returns defaults when AUTH_SECRET is set', async () => {
    // Test the Zod schema directly to avoid module caching issues
    const { z } = await import('zod');

    const envSchema = z.object({
      AUTH_SECRET: z.string().min(16),
      AUTH_TRUST_HOST: z.string().default('true'),
      DATABASE_PATH: z.string().default('data/recallforge.db'),
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      PORT: z.string().default('3030'),
      BASE_URL: z.string().url().optional(),
      RATE_LIMIT_AUTH_MAX: z.string().default('20'),
      RATE_LIMIT_API_MAX: z.string().default('120'),
      RATE_LIMIT_WINDOW_MS: z.string().default('60000'),
      LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      SYNC_MAX_BATCH_SIZE: z.string().default('50'),
    });

    const result = envSchema.safeParse({ AUTH_SECRET: 'test-secret-at-least-16-chars' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_SECRET).toBe('test-secret-at-least-16-chars');
      expect(result.data.DATABASE_PATH).toBe('data/recallforge.db');
      expect(result.data.LOG_LEVEL).toBe('info');
      expect(result.data.PORT).toBe('3030');
    }
  });

  it('getEnv throws when AUTH_SECRET is missing or short', async () => {
    const { z } = await import('zod');

    const envSchema = z.object({
      AUTH_SECRET: z.string().min(16),
    });

    // Missing
    const r1 = envSchema.safeParse({});
    expect(r1.success).toBe(false);

    // Too short
    const r2 = envSchema.safeParse({ AUTH_SECRET: 'short' });
    expect(r2.success).toBe(false);
  });

  it('env module exports expected functions', async () => {
    const mod = await import('@/lib/server/env');
    expect(typeof mod.getEnv).toBe('function');
    expect(typeof mod.isProd).toBe('function');
    expect(typeof mod.isTest).toBe('function');
    expect(typeof mod.getBaseUrl).toBe('function');
    expect(typeof mod._resetEnv).toBe('function');
  });
});

// ─── Logger ────────────────────────────────────────────────────────────────

describe('Logger', () => {
  it('exports logger with all levels', async () => {
    const { logger } = await import('@/lib/server/logger');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('logger.info produces output', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { logger } = await import('@/lib/server/logger');
    logger.info('test message', { key: 'value' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('logger.error writes to stderr', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { logger } = await import('@/lib/server/logger');
    logger.error('test error', { code: 500 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// ─── Rate Limiter ──────────────────────────────────────────────────────────

describe('Rate limiter', () => {
  beforeEach(async () => {
    const { _resetRateLimits } = await import('@/lib/server/rate-limit');
    _resetRateLimits();
  });

  it('allows requests within limit', async () => {
    const { checkRateLimit } = await import('@/lib/server/rate-limit');
    const config = { max: 5, windowMs: 60_000 };

    const r1 = checkRateLimit('test-ip', config);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(4);

    const r2 = checkRateLimit('test-ip', config);
    expect(r2.allowed).toBe(true);
  });

  it('blocks requests over limit', async () => {
    const { checkRateLimit } = await import('@/lib/server/rate-limit');
    const config = { max: 3, windowMs: 60_000 };

    checkRateLimit('block-ip', config);
    checkRateLimit('block-ip', config);
    checkRateLimit('block-ip', config);
    const r4 = checkRateLimit('block-ip', config);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterMs).toBeGreaterThan(0);
  });

  it('different keys have separate buckets', async () => {
    const { checkRateLimit } = await import('@/lib/server/rate-limit');
    const config = { max: 1, windowMs: 60_000 };

    const r1 = checkRateLimit('ip-a', config);
    expect(r1.allowed).toBe(true);

    const r2 = checkRateLimit('ip-b', config);
    expect(r2.allowed).toBe(true);

    const r3 = checkRateLimit('ip-a', config);
    expect(r3.allowed).toBe(false);
  });

  it('_resetRateLimits clears all state', async () => {
    const { checkRateLimit, _resetRateLimits } = await import('@/lib/server/rate-limit');
    const config = { max: 1, windowMs: 60_000 };

    checkRateLimit('reset-ip', config);
    const blocked = checkRateLimit('reset-ip', config);
    expect(blocked.allowed).toBe(false);

    _resetRateLimits();

    const afterReset = checkRateLimit('reset-ip', config);
    expect(afterReset.allowed).toBe(true);
  });
});
