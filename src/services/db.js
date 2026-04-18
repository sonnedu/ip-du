/**
 * db.js — Node.js MMDB database service
 *
 * Loads MaxMind MMDB files from the local ./data directory using mmdb-lib.
 * Provides city-level geolocation and ASN lookups for both IPv4 and IPv6.
 *
 * Database files (not committed to git, downloaded via scripts/update-db.js):
 *   data/dbip-city-ipv4.mmdb
 *   data/dbip-city-ipv6.mmdb
 *   data/asn.mmdb
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Reader } from 'mmdb-lib';
import { loadConfig } from '../utils/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cityV4Reader = null;
let cityV6Reader = null;
let asnReader   = null;
let initialized = false;

/**
 * Load MMDB readers from disk. Safe to call multiple times (idempotent).
 */
export function initDb() {
  if (initialized) return;
  initialized = true;

  const config  = loadConfig();
  const dataDir = join(__dirname, '..', '..', config.database.dataDir.replace('./', ''));

  const paths = {
    cityV4: join(dataDir, 'dbip-city-ipv4.mmdb'),
    cityV6: join(dataDir, 'dbip-city-ipv6.mmdb'),
    asn:    join(dataDir, 'asn.mmdb'),
  };

  try {
    if (existsSync(paths.cityV4)) {
      cityV4Reader = new Reader(readFileSync(paths.cityV4));
      console.log('[db] Loaded city IPv4 database');
    } else {
      console.warn('[db] city IPv4 database not found — run: npm run update-db');
    }

    if (existsSync(paths.cityV6)) {
      cityV6Reader = new Reader(readFileSync(paths.cityV6));
      console.log('[db] Loaded city IPv6 database');
    } else {
      console.warn('[db] city IPv6 database not found — run: npm run update-db');
    }

    if (existsSync(paths.asn)) {
      asnReader = new Reader(readFileSync(paths.asn));
      console.log('[db] Loaded ASN database');
    } else {
      console.warn('[db] ASN database not found — run: npm run update-db');
    }
  } catch (err) {
    console.error('[db] Error loading database files:', err.message);
  }
}

/**
 * Reload readers — called after a database update.
 */
export function reloadDb() {
  initialized = false;
  cityV4Reader = null;
  cityV6Reader = null;
  asnReader    = null;
  initDb();
}

/**
 * Look up geolocation + ASN data for an IP address.
 * @param {string} ip
 * @returns {import('./lookup.js').LookupResult}
 */
export function lookupIp(ip) {
  if (!initialized) initDb();

  const isV6     = ip.includes(':');
  const cityReader = isV6 ? cityV6Reader : cityV4Reader;

  let cityData = null;
  let asnData  = null;

  try {
    if (cityReader) cityData = cityReader.get(ip);
  } catch {
    // Private / reserved address — no data
  }

  try {
    if (asnReader) asnData = asnReader.get(ip);
  } catch {
    // ignore
  }

  return formatResult(ip, cityData, asnData);
}

/**
 * Map raw MMDB records to the standard LookupResult shape.
 */
function formatResult(ip, city, asn) {
  const countryNames = city?.country?.names ?? {};
  const cityNames    = city?.city?.names    ?? {};
  const subdivisions = city?.subdivisions   ?? [];
  const location     = city?.location       ?? {};
  const continent    = city?.continent      ?? {};

  return {
    ip,
    version:     ip.includes(':') ? 'IPv6' : 'IPv4',
    city:        cityNames.en        || null,
    region:      subdivisions[0]?.names?.en || null,
    country:     countryNames.en     || null,
    countryCode: city?.country?.iso_code || null,
    continent:   continent.code      || null,
    lat:         location.latitude   ?? null,
    lon:         location.longitude  ?? null,
    timezone:    location.time_zone  || null,
    asn:         asn?.autonomous_system_number
                   ? `AS${asn.autonomous_system_number}`
                   : null,
    org:         asn?.autonomous_system_organization || null,
    isp:         asn?.autonomous_system_organization || null,
    source:      'mmdb',
  };
}
