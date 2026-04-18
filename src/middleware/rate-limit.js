/**
 * rate-limit.js
 * Sliding-window in-memory rate limiter for Hono.
 * Works in Node.js (persistent process) and Cloudflare Workers (per-isolate).
 *
 * Configuration is read from config/default.json:
 *   rateLimit.page  — applied to GET /
 *   rateLimit.api   — applied to GET /api/*
 */

/** @type {Map<string, Map<string, number[]>>} key → ip → timestamps */
const stores = new Map();

/**
 * Create a Hono rate-limiter middleware.
 * @param {{ windowMs: number, max: number }} config
 * @param {string} storeKey  – unique key to separate page vs api buckets
 * @returns {import('hono').MiddlewareHandler}
 */
export function createRateLimiter(config, storeKey = 'default') {
  if (!stores.has(storeKey)) stores.set(storeKey, new Map());
  const store = stores.get(storeKey);
  const { windowMs, max } = config;

  // Periodic cleanup of expired entries (Node.js only; setInterval is a no-op in Workers)
  if (typeof setInterval !== 'undefined') {
    setInterval(() => {
      const cutoff = Date.now() - windowMs;
      for (const [ip, ts] of store) {
        const fresh = ts.filter(t => t > cutoff);
        if (fresh.length === 0) store.delete(ip);
        else store.set(ip, fresh);
      }
    }, Math.min(windowMs, 5 * 60_000)).unref?.();
  }

  return async (c, next) => {
    const ip = c.get('clientIp') || extractIp(c) || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;

    const timestamps = (store.get(ip) ?? []).filter(t => t > cutoff);

    if (timestamps.length >= max) {
      const oldestInWindow = timestamps[0];
      const resetAt = Math.ceil((oldestInWindow + windowMs) / 1000);
      const retryAfter = Math.max(1, Math.ceil((oldestInWindow + windowMs - now) / 1000));

      return c.json(
        {
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
          retryAfter,
        },
        429,
        {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetAt),
        },
      );
    }

    timestamps.push(now);
    store.set(ip, timestamps);

    const remaining = max - timestamps.length;
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

    await next();
  };
}

function extractIp(c) {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0].trim() ||
    c.req.header('X-Real-IP') ||
    null
  );
}
