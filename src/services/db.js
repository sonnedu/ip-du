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
export function formatResult(ip, city, asn) {
  // 1. Geolocation (City/Country)
  let cityName    = city?.city;
  let regionName  = city?.state1;
  let countryCode = city?.country_code;
  let latitude    = city?.latitude;
  let longitude   = city?.longitude;

  // MaxMind style fallback
  if (typeof cityName === 'object') cityName = cityName.names?.en;
  if (city?.subdivisions)          regionName = city.subdivisions[0]?.names?.en;
  if (city?.country)               countryCode = city.country.iso_code;
  if (city?.location) {
    latitude  = city.location.latitude;
    longitude = city.location.longitude;
  }

  // 2. Country Name
  let countryName = city?.country?.names?.en || null;
  if (!countryName && countryCode) {
    const codes = { 'US': 'United States', 'CN': 'China', 'JP': 'Japan', 'TW': 'Taiwan', 'HK': 'Hong Kong', 'GB': 'United Kingdom', 'DE': 'Germany' };
    countryName = codes[countryCode] || countryCode;
  }

  // 3. ASN/Organization
  const asnNumber = asn?.autonomous_system_number || city?.autonomous_system_number;
  const asnOrg    = asn?.autonomous_system_organization || city?.autonomous_system_organization;

  // 4. IP Purity & Usage Type (Heuristic Model)
  let usageType = 'Residential';
  let riskScore = 0;
  const orgLower = (asnOrg || '').toLowerCase();

  const idcKeywords = ['cloud', 'hosting', 'datacenter', 'server', 'vps', 'amazon', 'google', 'microsoft', 'azure', 'digitalocean', 'linode', 'vultr', 'hetzner', 'ovh', 'oracle', 'alibaba', 'tencent', 'host', 'choopa', 'zenlayer'];
  const mobileKeywords = ['mobile', 'wireless', 'telekom', 'cellular', 'vodafone', 't-mobile'];

  if (idcKeywords.some(k => orgLower.includes(k))) {
    usageType = 'Data Center';
    riskScore = 60 + Math.floor(Math.random() * 20); // Base high risk for IDC
  } else if (mobileKeywords.some(k => orgLower.includes(k))) {
    usageType = 'Mobile';
    riskScore = 5 + Math.floor(Math.random() * 10);
  } else if (orgLower.includes('university') || orgLower.includes('school')) {
    usageType = 'Education';
    riskScore = 10;
  }

  // 5. Timezone Fix
  let timezone = city?.location?.time_zone || city?.timezone;
  if (!timezone && longitude !== undefined && longitude !== null) {
    const offset = Math.round(longitude / 15);
    const sign = offset >= 0 ? '+' : '-';
    timezone = `GMT${sign}${Math.abs(offset)}`;
  }

  return {
    ip,
    version:     ip.includes(':') ? 'IPv6' : 'IPv4',
    city:        cityName    || null,
    region:      regionName  || null,
    country:     countryName || null,
    countryCode: countryCode || null,
    continent:   city?.continent?.code || null,
    lat:         latitude  ?? null,
    lon:         longitude ?? null,
    timezone:    timezone  || null,
    asn:         asnNumber ? `AS${asnNumber}` : null,
    org:         asnOrg    || null,
    isp:         asnOrg    || null,
    type:        usageType,
    risk:        riskScore,
    isNative:    !!(countryCode && (cityName || regionName)),
    source:      'mmdb',
  };
}


