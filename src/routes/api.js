/**
 * api.js — /api/* route handlers
 *
 * Endpoints:
 *   GET /api/lookup            — look up the requesting client's own IP
 *   GET /api/lookup?q=<value>  — look up a specific IP address or domain name
 *
 * Runtime detection:
 *   The file checks for the presence of `c.get('IS_WORKER')` (set by worker.js)
 *   to choose between Node.js (MMDB) and CF Workers (request.cf + MMDB) paths.
 *
 * Example response:
 *   {
 *     "ip": "8.8.8.8",
 *     "version": "IPv4",
 *     "city": "Mountain View",
 *     "region": "California",
 *     "country": "United States",
 *     "countryCode": "US",
 *     "continent": "NA",
 *     "lat": 37.386,
 *     "lon": -122.0838,
 *     "timezone": "America/Los_Angeles",
 *     "asn": "AS15169",
 *     "org": "Google LLC",
 *     "isp": "Google LLC",
 *     "source": "mmdb",
 *     "query": "8.8.8.8",
 *     "queryType": "ip"
 *   }
 */

import { Hono } from 'hono';
import { resolveNode, resolveWorker } from '../services/lookup.js';

export const apiRouter = new Hono();

apiRouter.get('/lookup', async (c) => {
  const query    = c.req.query('q') || null;
  const clientIp = c.get('clientIp') || '127.0.0.1';
  const isWorker = c.get('IS_WORKER'); // set by worker.js

  let result;

  if (isWorker) {
    // Cloudflare Workers path
    const cf  = c.get('CF_PROPS'); // set by worker.js from request.cf
    const env = c.env;
    result = await resolveWorker(query, clientIp, cf, env);
  } else {
    // Node.js path
    result = await resolveNode(query, clientIp);
  }

  if (result.error) {
    const status = result.error.includes('Could not resolve') ? 404 : 400;
    return c.json({ error: result.error, query: result.query, queryType: result.queryType }, status);
  }

  return c.json(result);
});

// Health check
apiRouter.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 for unknown /api/* paths
apiRouter.all('*', (c) => {
  return c.json({ error: 'Not Found', message: 'Unknown API endpoint' }, 404);
});
