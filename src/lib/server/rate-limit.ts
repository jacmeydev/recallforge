// ============================================================================
// RecallForge — In-memory Rate Limiter
// ============================================================================
// Sliding-window rate limiter for Edge middleware and route handlers.
// In-memory only (no external deps). Resets on server restart, which is fine
// for a self-hosted SQLite app.
// ============================================================================

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent memory leak (every 5 minutes)
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      // Remove entries that haven't been seen in 10 minutes
      if (now - entry.lastRefill > 600_000) {
        buckets.delete(key);
      }
    }
  }, 300_000);
  // Prevent keeping the process alive
  if (cleanupInterval && typeof cleanupInterval === 'object' && 'unref' in cleanupInterval) {
    cleanupInterval.unref();
  }
}

export interface RateLimitConfig {
  /** Max requests in the window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Token-bucket rate limiter.
 * @param key - Unique identifier (e.g., IP + route prefix)
 * @param config - Rate limit configuration
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  startCleanup();

  const now = Date.now();
  let entry = buckets.get(key);

  if (!entry) {
    entry = { tokens: config.max - 1, lastRefill: now };
    buckets.set(key, entry);
    return { allowed: true, remaining: entry.tokens, retryAfterMs: 0 };
  }

  // Refill tokens based on elapsed time
  const elapsed = now - entry.lastRefill;
  const refillRate = config.max / config.windowMs;
  const refill = elapsed * refillRate;
  entry.tokens = Math.min(config.max, entry.tokens + refill);
  entry.lastRefill = now;

  if (entry.tokens >= 1) {
    entry.tokens -= 1;
    return { allowed: true, remaining: Math.floor(entry.tokens), retryAfterMs: 0 };
  }

  // Not enough tokens
  const retryAfterMs = Math.ceil((1 - entry.tokens) / refillRate);
  return { allowed: false, remaining: 0, retryAfterMs };
}

/** Reset all buckets (for testing) */
export function _resetRateLimits(): void {
  buckets.clear();
}
