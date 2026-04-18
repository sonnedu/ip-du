/**
 * update-db.js — Download / update IP geolocation MMDB databases
 *
 * Sources: sapics/ip-location-db (https://github.com/sapics/ip-location-db)
 * Distributed via jsDelivr CDN as npm packages.
 *
 * Version tracking: compares "last-modified" HTTP header against stored value
 * in data/.db-version so we only re-download when the file has changed.
 *
 * Usage:
 *   node scripts/update-db.js           — check & update if needed
 *   node scripts/update-db.js --force   — always re-download
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const DATA_DIR  = join(ROOT, 'data');
const VERSION_FILE = join(DATA_DIR, '.db-version');

const FORCE = process.argv.includes('--force');

// ─── Database file definitions ────────────────────────────────────────────────
const DATABASES = [
  {
    name:    'city_ipv4',
    file:    'dbip-city-ipv4.mmdb',
    package: '@ip-location-db/dbip-city-mmdb',
    path:    'dbip-city-ipv4.mmdb',
  },
  {
    name:    'city_ipv6',
    file:    'dbip-city-ipv6.mmdb',
    package: '@ip-location-db/dbip-city-mmdb',
    path:    'dbip-city-ipv6.mmdb',
  },
  {
    name:    'asn',
    file:    'asn.mmdb',
    package: '@ip-location-db/asn-mmdb',
    path:    'asn.mmdb',
  },
];

function cdnUrl(pkg, filePath) {
  // unpkg.com handles large MMDB files correctly (jsDelivr returns 403 for files >50MB)
  return `https://unpkg.com/${pkg}/${filePath}`;
}

// ─── Version store ────────────────────────────────────────────────────────────
function loadVersions() {
  try {
    return JSON.parse(readFileSync(VERSION_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveVersions(versions) {
  writeFileSync(VERSION_FILE, JSON.stringify(versions, null, 2), 'utf-8');
}

// ─── Download helper ──────────────────────────────────────────────────────────
async function download(url, destPath) {
  console.log(`  ⬇  Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const out = createWriteStream(destPath + '.tmp');
  await pipeline(res.body, out);
  // Atomic rename
  const { rename } = await import('node:fs/promises');
  await rename(destPath + '.tmp', destPath);
  return res.headers.get('last-modified') || res.headers.get('etag') || Date.now().toString();
}

async function getRemoteVersion(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.headers.get('last-modified') || res.headers.get('etag') || null;
  } catch {
    return null;
  }
}

// ─── Main update logic ────────────────────────────────────────────────────────
async function updateDatabases() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const versions = loadVersions();
  let updated    = false;

  for (const db of DATABASES) {
    const url      = cdnUrl(db.package, db.path);
    const destPath = join(DATA_DIR, db.file);

    console.log(`\n[${db.name}]`);

    if (!FORCE) {
      const remoteVer = await getRemoteVersion(url);
      const localVer  = versions[db.name];

      if (remoteVer && remoteVer === localVer && existsSync(destPath)) {
        console.log(`  ✔  Up-to-date (${remoteVer})`);
        continue;
      }
    }

    try {
      const newVer = await download(url, destPath);
      versions[db.name] = newVer;
      console.log(`  ✔  Saved to ${destPath} (${newVer})`);
      updated = true;
    } catch (err) {
      console.error(`  ✗  Failed: ${err.message}`);
    }
  }

  saveVersions(versions);

  if (updated) {
    console.log('\n✅ Databases updated. Restart the server to load new data.');
  } else {
    console.log('\n✅ All databases are up-to-date.');
  }
}

// ─── Scheduled runner (used by server.js) ────────────────────────────────────

/**
 * Start the auto-update scheduler.
 * @param {number} intervalMs  — from config.database.checkIntervalMs
 */
export function startUpdateScheduler(intervalMs) {
  // Run immediately on startup
  updateDatabases().catch(err => console.error('[update-db] startup check failed:', err));

  // Then on schedule
  const timer = setInterval(() => {
    console.log('[update-db] Scheduled check…');
    updateDatabases().catch(err => console.error('[update-db] scheduled check failed:', err));
  }, intervalMs);

  timer.unref(); // Don't keep process alive just for this timer
  return timer;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updateDatabases()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
