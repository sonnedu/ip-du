/**
 * server.js — Node.js entry point (VPS / local development)
 *
 * Starts a Hono app on @hono/node-server, mounts all middleware and routes,
 * and starts the IP database auto-update scheduler.
 *
 * Usage:
 *   node src/server.js          — production
 *   node --watch src/server.js  — development with hot-reload
 *   pm2 start ecosystem.config.cjs — managed by PM2
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig } from './utils/config.js';
import { clientIpMiddleware } from './middleware/client-ip.js';
import { corsMiddleware } from './middleware/cors.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { apiRouter } from './routes/api.js';
import { pageRouter } from './routes/page.js';
import { initDb } from './services/db.js';
import { startUpdateScheduler } from '../scripts/update-db.js';

// ─── Config ───────────────────────────────────────────────────────
const config = loadConfig();
const { port, host } = config.server;

// ─── Hono App ────────────────────────────────────────────────────
const app = new Hono();

// Global middleware
app.use('*', clientIpMiddleware());
app.use('/api/*', corsMiddleware());

// Rate limiting (separate buckets for page and API)
app.use('/',     createRateLimiter(config.rateLimit.page, 'page'));
app.use('/api/*', createRateLimiter(config.rateLimit.api, 'api'));

// Routes
app.route('/api', apiRouter);
app.route('/', pageRouter);

// 404 fallback
app.notFound((c) => {
  const accept = c.req.header('Accept') ?? '';
  if (accept.includes('application/json')) {
    return c.json({ error: 'Not Found' }, 404);
  }
  return c.redirect('/');
});

// ─── Startup ─────────────────────────────────────────────────────

// Pre-load the MMDB databases
initDb();

// Start the database auto-update scheduler
if (config.database.autoUpdate) {
  startUpdateScheduler(config.database.checkIntervalMs);
}

// Start HTTP server
serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  const addr = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${info.port}`;
  console.log(`\n🌐 IP-Du server running at ${addr}`);
  console.log(`   API: ${addr}/api/lookup`);
  console.log(`   Env: ${process.env.NODE_ENV || 'development'}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n[server] SIGTERM received — shutting down gracefully');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('\n[server] SIGINT received — shutting down gracefully');
  process.exit(0);
});
