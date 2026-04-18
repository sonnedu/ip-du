/**
 * page.js — serves the frontend SPA
 *
 * Node.js: reads src/views/index.html from disk at startup (cached in memory).
 * CF Workers: imports the bundled HTML via Wrangler's text module rule.
 */

import { Hono } from 'hono';

export const pageRouter = new Hono();

// ─── Load HTML ────────────────────────────────────────────────────────────────

let cachedHtml = null;

async function getHtml() {
  if (cachedHtml) return cachedHtml;

  // In Node.js we can read from the filesystem
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    cachedHtml = readFileSync(join(__dirname, '..', 'views', 'index.html'), 'utf-8');
    return cachedHtml;
  }

  // In CF Workers, this module is bundled via the text rule in wrangler.toml
  // The worker.js sets the html on the router directly — see worker.js
  return '<html><body>Loading…</body></html>';
}

pageRouter.get('/', async (c) => {
  const html = c.get('APP_HTML') || await getHtml();
  return c.html(html);
});

});
