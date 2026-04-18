import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let _config = null;

/**
 * Load configuration from config/default.json (Node.js environment)
 */
export function loadConfig() {
  if (_config) return _config;

  try {
    const configPath = join(__dirname, '..', '..', 'config', 'default.json');
    const raw = readFileSync(configPath, 'utf-8');
    _config = JSON.parse(raw);
  } catch {
    _config = getDefaultConfig();
  }

  return _config;
}

/**
 * Get config for Cloudflare Workers environment (from env bindings or defaults)
 */
export function loadConfigFromEnv(env = {}) {
  return {
    server: {
      port: parseInt(env.PORT || '3000', 10),
      host: env.HOST || '0.0.0.0',
    },
    rateLimit: {
      page: {
        windowMs: parseInt(env.RATE_LIMIT_PAGE_WINDOW || '60000', 10),
        max: parseInt(env.RATE_LIMIT_PAGE_MAX || '30', 10),
      },
      api: {
        windowMs: parseInt(env.RATE_LIMIT_API_WINDOW || '60000', 10),
        max: parseInt(env.RATE_LIMIT_API_MAX || '60', 10),
      },
    },
    database: getDefaultConfig().database,
    i18n: getDefaultConfig().i18n,
  };
}

/**
 * Fallback default configuration
 */
function getDefaultConfig() {
  return {
    server: { port: 3000, host: '0.0.0.0' },
    rateLimit: {
      page: { windowMs: 60000, max: 30 },
      api: { windowMs: 60000, max: 60 },
    },
    database: {
      autoUpdate: true,
      checkIntervalMs: 86400000,
      sources: {
        city_ipv4: 'https://cdn.jsdelivr.net/npm/@ip-location-db/dbip-city-mmdb/dbip-city-ipv4.mmdb',
        city_ipv6: 'https://cdn.jsdelivr.net/npm/@ip-location-db/dbip-city-mmdb/dbip-city-ipv6.mmdb',
        asn: 'https://cdn.jsdelivr.net/npm/@ip-location-db/asn-mmdb/asn.mmdb',
      },
      githubRepo: 'sapics/ip-location-db',
      dataDir: './data',
    },
    i18n: {
      defaultLocale: 'en',
      supportedLocales: ['en', 'zh-CN', 'zh-TW', 'ja'],
    },
  };
}
