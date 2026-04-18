/**
 * worker.js — Cloudflare Workers entry point
 *
 * Exports a fetch handler compatible with the Cloudflare Workers ES module format.
 * Mounts the same Hono routes as server.js but uses CF-specific middleware.
 *
 * Environment bindings (configured in wrangler.toml):
 *   DB_BUCKET    — R2 bucket for MMDB files (optional, uses CDN fallback)
 *   RL_KV        — KV namespace for distributed rate limiting (optional)
 *   RATE_LIMIT_PAGE_WINDOW, RATE_LIMIT_PAGE_MAX
 *   RATE_LIMIT_API_WINDOW,  RATE_LIMIT_API_MAX
 */

import { Hono } from 'hono';
import { clientIpMiddleware } from './middleware/client-ip.js';
import { corsMiddleware } from './middleware/cors.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { apiRouter } from './routes/api.js';
import { pageRouter } from './routes/page.js';
// Bundled via wrangler text module rule (see wrangler.toml [[rules]])
import appHtml from './views/index.html';

const app = new Hono();

// Inject runtime flags and CF-specific properties into the Hono context
app.use('*', async (c, next) => {
  c.set('IS_WORKER', true);
  // Expose Cloudflare's request.cf geolocation object
  c.set('CF_PROPS', c.req.raw.cf ?? null);
  await next();
});

// Inject the bundled HTML for the page router
app.use('/', async (c, next) => {
  c.set('APP_HTML', appHtml);
  await next();
});

// Global middleware
app.use('*', clientIpMiddleware());
app.use('/api/*', corsMiddleware());

// Rate limiting (config from env bindings)
app.use('/', (c, next) => {
  const env = c.env ?? {};
  const config = {
    windowMs: parseInt(env.RATE_LIMIT_PAGE_WINDOW ?? '60000', 10),
    max:      parseInt(env.RATE_LIMIT_PAGE_MAX    ?? '30',    10),
  };
  return createRateLimiter(config, 'page')(c, next);
});

app.use('/api/*', (c, next) => {
  const env = c.env ?? {};
  const config = {
    windowMs: parseInt(env.RATE_LIMIT_API_WINDOW ?? '60000', 10),
    max:      parseInt(env.RATE_LIMIT_API_MAX    ?? '60',    10),
  };
  return createRateLimiter(config, 'api')(c, next);
});

// Routes
app.route('/api', apiRouter);
app.route('/', pageRouter);

// 404 fallback
app.notFound((c) => {
  const accept = c.req.header('Accept') ?? '';
  if (accept.includes('application/json')) {
    return c.json({ error: 'Not Found' }, 404);
  }
  return Response.redirect(new URL('/', c.req.url).href);
});

export default {
  fetch: app.fetch,
};
