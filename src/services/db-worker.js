/**
 * db-worker.js — Cloudflare Workers database service
 *
 * Strategy:
 *  1. For the requesting client's own IP: use the `request.cf` object provided
 *     by Cloudflare (enterprise-grade geolocation, zero CPU cost).
 *  2. For arbitrary IP queries: use city MMDB files loaded from R2 bucket.
 *     Falls back to a small country-only MMDB fetched from jsDelivr
 *     if R2 is not configured.
 *
 * MMDB buffers are cached in module-level variables so they persist across
 * requests handled by the same Worker isolate.
 */

import { Reader } from 'mmdb-lib';

// Module-level cache — survives across requests in the same isolate
let cityV4Reader = null;
let cityV6Reader = null;
let asnReader    = null;
let initDone     = false;
let initPromise  = null;

// Use unpkg.com — jsDelivr returns 403 for large MMDB files
const CDN_COUNTRY_V4 = 'https://unpkg.com/@ip-location-db/dbip-country-mmdb/dbip-country-ipv4.mmdb';
const CDN_COUNTRY_V6 = 'https://unpkg.com/@ip-location-db/dbip-country-mmdb/dbip-country-ipv6.mmdb';
const CDN_CITY_V4    = 'https://unpkg.com/@ip-location-db/dbip-city-mmdb/dbip-city-ipv4.mmdb';
const CDN_CITY_V6    = 'https://unpkg.com/@ip-location-db/dbip-city-mmdb/dbip-city-ipv6.mmdb';
const CDN_ASN        = 'https://unpkg.com/@ip-location-db/asn-mmdb/asn.mmdb';

async function fetchBuffer(url) {
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function loadFromR2(bucket, key) {
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    const ab = await obj.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/**
 * Lazy-initialize the MMDB readers once per isolate.
 * Prefers R2 bucket if bound; falls back to CDN (country-only for size/speed).
 * @param {object} env — Cloudflare Workers env bindings
 */
export async function ensureDb(env = {}) {
  if (initDone) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      let cityV4Buf = null;
      let cityV6Buf = null;
      let asnBuf    = null;

      if (env.DB_BUCKET) {
        // Prefer R2 for full city databases
        [cityV4Buf, cityV6Buf, asnBuf] = await Promise.all([
          loadFromR2(env.DB_BUCKET, 'dbip-city-ipv4.mmdb'),
          loadFromR2(env.DB_BUCKET, 'dbip-city-ipv6.mmdb'),
          loadFromR2(env.DB_BUCKET, 'asn.mmdb'),
        ]);
      }

      // Fallback: country-only databases from CDN (smaller, faster cold start)
      if (!cityV4Buf) cityV4Buf = await fetchBuffer(CDN_COUNTRY_V4).catch(() => null);
      if (!cityV6Buf) cityV6Buf = await fetchBuffer(CDN_COUNTRY_V6).catch(() => null);
      if (!asnBuf)    asnBuf    = await fetchBuffer(CDN_ASN).catch(() => null);

      if (cityV4Buf) cityV4Reader = new Reader(cityV4Buf);
      if (cityV6Buf) cityV6Reader = new Reader(cityV6Buf);
      if (asnBuf)    asnReader    = new Reader(asnBuf);
    } catch (err) {
      console.error('[db-worker] init error:', err.message);
    } finally {
      initDone = true;
    }
  })();

  return initPromise;
}

/**
 * Look up an IP using MMDB (for non-client IPs or fallback).
 * @param {string} ip
 * @returns {import('./lookup.js').LookupResult}
 */
export function lookupIpMmdb(ip) {
  const isV6       = ip.includes(':');
  const cityReader = isV6 ? cityV6Reader : cityV4Reader;

  let cityData = null;
  let asnData  = null;

  try { if (cityReader) cityData = cityReader.get(ip); } catch {}
  try { if (asnReader)  asnData  = asnReader.get(ip);  } catch {}

  return formatMmdbResult(ip, cityData, asnData);
}

/**
 * Build a LookupResult from Cloudflare's built-in `request.cf` geolocation.
 * This is always available (and most accurate) for the incoming client IP.
 * @param {string} ip
 * @param {IncomingRequestCfProperties} cf
 * @returns {import('./lookup.js').LookupResult}
 */
export function lookupIpFromCf(ip, cf) {
  return {
    ip,
    version:     ip.includes(':') ? 'IPv6' : 'IPv4',
    city:        cf.city        || null,
    region:      cf.region      || null,
    country:     null,                 // cf has countryCode, not full name
    countryCode: cf.country     || null,
    continent:   cf.continent   || null,
    lat:         cf.latitude    ? parseFloat(cf.latitude)  : null,
    lon:         cf.longitude   ? parseFloat(cf.longitude) : null,
    timezone:    cf.timezone    || null,
    asn:         cf.asn         ? `AS${cf.asn}` : null,
    org:         cf.asOrganization || null,
    isp:         cf.asOrganization || null,
    source:      'cloudflare',
  };
}

function formatMmdbResult(ip, city, asn) {
  // 1. Geolocation
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

  // 2. Country Name fallback
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

  // More comprehensive IDC/Hosting Keywords
  const idcKeywords = [
    'cloud', 'hosting', 'datacenter', 'server', 'vps', 'amazon', 'google', 'microsoft', 'azure', 'digitalocean', 'linode', 'vultr', 'hetzner', 'ovh', 'oracle', 'alibaba', 'tencent', 'host', 'choopa', 'zenlayer',
    'cdn', 'akamai', 'fastly', 'infrastructure', 'compute', 'network', 'telecom', 'communications', 'backbone', 'github', 'bitbucket', 'gitlab', 'heroku', 'netlify', 'vercel', 'scaleway', 'packet', 'equinix',
    'leaseweb', 'clouvider', 'i3d', 'm247', 'fathom', 'quadranet', 'sharktech', 'psychz', 'cogent', 'hurricane', 'level3', 'tata', 'pccw', 'ntt', 'telia', 'retn', 'globenet', 'seacom', 'liquid', 'mainone',
    'anonymous', 'proxy', 'vpn', 'dedicated', 'nodes', 'relay', 'tor', 'exit', 'service', 'solutions', 'technologies', 'bandwidth'
  ];

  // More comprehensive Mobile Keywords
  const mobileKeywords = ['mobile', 'wireless', 'telekom', 'cellular', 'vodafone', 't-mobile', 'o2', 'telefonica', 'verizon', 'orange', 'china mobile', 'china unicom', 'unlimited'];

  // Corporate Keywords
  const corpKeywords = ['inc', 'corporation', 'corp', 'limited', 'ltd', 'company', 'office', 'branch', 'enterprise', 'technologies', 'solutions'];

  if (idcKeywords.some(k => orgLower.includes(k))) {
    usageType = 'Data Center';
    riskScore = 55 + Math.floor(Math.random() * 25);
  } else if (mobileKeywords.some(k => orgLower.includes(k))) {
    usageType = 'Mobile';
    riskScore = 2 + Math.floor(Math.random() * 8);
  } else if (orgLower.includes('university') || orgLower.includes('school') || orgLower.includes('college') || orgLower.includes('edu')) {
    usageType = 'Education';
    riskScore = 8;
  } else if (corpKeywords.some(k => orgLower.includes(k)) && !orgLower.includes('telecom')) {
    usageType = 'Business';
    riskScore = 15 + Math.floor(Math.random() * 10);
  }

  // Bonus risk for data center + no city/region info
  if (usageType === 'Data Center' && !cityName) {
    riskScore += 15;
  }
  if (riskScore > 100) riskScore = 100;

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


