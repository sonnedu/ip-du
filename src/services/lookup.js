/**
 * lookup.js — Shared IP & domain lookup logic
 *
 * Provides:
 *   resolveInput(input, env?)  — detect input type, resolve domain → IP, return result
 *   lookupIpNode(ip)           — Node.js: MMDB lookup
 *   lookupIpWorker(ip, cf, env)— CF Workers: cf object or MMDB
 *
 * @typedef {Object} LookupResult
 * @property {string}      ip
 * @property {string}      version     — 'IPv4' | 'IPv6'
 * @property {string|null} city
 * @property {string|null} region
 * @property {string|null} country
 * @property {string|null} countryCode — ISO 3166-1 alpha-2
 * @property {string|null} continent
 * @property {number|null} lat
 * @property {number|null} lon
 * @property {string|null} timezone
 * @property {string|null} asn
 * @property {string|null} org
 * @property {string|null} isp
 * @property {string}      source      — 'mmdb' | 'cloudflare'
 * @property {string}      query       — original user query
 * @property {'ip'|'domain'|'self'} queryType
 * @property {string|null} [domain]    — resolved domain name (if queryType=domain)
 */

// ─── Node.js DNS resolution ───────────────────────────────────────────────────

/** @param {string} hostname @returns {Promise<string|null>} */
async function resolveHostNode(hostname) {
  try {
    const { resolve4, resolve6 } = await import('node:dns/promises');
    try { const [ip] = await resolve4(hostname); return ip; } catch {}
    try { const [ip] = await resolve6(hostname); return ip; } catch {}
    return null;
  } catch {
    return null;
  }
}

// ─── Cloudflare Workers DNS-over-HTTPS resolution ────────────────────────────

/** @param {string} hostname @param {'A'|'AAAA'} [type] @returns {Promise<string|null>} */
async function resolveHostWorker(hostname, type = 'A') {
  try {
    const url = `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`;
    const res = await fetch(url, { headers: { Accept: 'application/dns-json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const answer = data?.Answer?.find(r => r.type === (type === 'A' ? 1 : 28));
    return answer?.data ?? null;
  } catch {
    return null;
  }
}

// ─── IP validation ────────────────────────────────────────────────────────────

const IPV4_RE  = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE  = /^[0-9a-fA-F:]+$/;
const FQDN_RE  = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export function isIpAddress(input) {
  return IPV4_RE.test(input) || IPV6_RE.test(input);
}

export function isDomain(input) {
  return FQDN_RE.test(input);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Node.js path: resolve input then MMDB lookup.
 * @param {string|null} query    — user query (IP, domain, or null for self)
 * @param {string}      clientIp — extracted client IP
 * @returns {Promise<LookupResult>}
 */
export async function resolveNode(query, clientIp) {
  const { lookupIp } = await import('./db.js');

  if (!query) {
    const result = lookupIp(clientIp);
    return { ...result, query: clientIp, queryType: 'self' };
  }

  const trimmed = query.trim();

  if (isIpAddress(trimmed)) {
    const result = lookupIp(trimmed);
    return { ...result, query: trimmed, queryType: 'ip' };
  }

  if (isDomain(trimmed)) {
    const resolved = await resolveHostNode(trimmed);
    if (!resolved) {
      return errorResult(trimmed, 'domain', 'Could not resolve domain');
    }
    const result = lookupIp(resolved);
    return { ...result, query: trimmed, queryType: 'domain', domain: trimmed };
  }

  return errorResult(trimmed, 'ip', 'Invalid IP address or domain');
}

/**
 * Cloudflare Workers path: use cf object for client IP, MMDB for others.
 * @param {string|null} query
 * @param {string}      clientIp
 * @param {object}      cf        — Cloudflare request.cf properties
 * @param {object}      env       — Worker env bindings
 * @returns {Promise<LookupResult>}
 */
export async function resolveWorker(query, clientIp, cf, env) {
  const { ensureDb, lookupIpMmdb, lookupIpFromCf } = await import('./db-worker.js');

  if (!query) {
    // Use Cloudflare's built-in geolocation for the client IP
    const result = cf ? lookupIpFromCf(clientIp, cf) : { ip: clientIp, source: 'unknown' };
    return { ...result, query: clientIp, queryType: 'self' };
  }

  const trimmed = query.trim();

  if (isIpAddress(trimmed)) {
    await ensureDb(env);
    const result = lookupIpMmdb(trimmed);
    return { ...result, query: trimmed, queryType: 'ip' };
  }

  if (isDomain(trimmed)) {
    const resolved =
      (await resolveHostWorker(trimmed, 'A')) ??
      (await resolveHostWorker(trimmed, 'AAAA'));

    if (!resolved) {
      return errorResult(trimmed, 'domain', 'Could not resolve domain');
    }
    await ensureDb(env);
    const result = lookupIpMmdb(resolved);
    return { ...result, query: trimmed, queryType: 'domain', domain: trimmed };
  }

  return errorResult(trimmed, 'ip', 'Invalid IP address or domain');
}

function errorResult(query, queryType, message) {
  return {
    ip: null,
    version: null,
    city: null, region: null, country: null, countryCode: null,
    continent: null, lat: null, lon: null, timezone: null,
    asn: null, org: null, isp: null,
    source: null,
    query,
    queryType,
    error: message,
  };
}
