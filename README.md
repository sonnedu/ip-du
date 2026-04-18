# IP-Du

**IP-Du** is a free, open-source IP address intelligence platform. It provides real-time geolocation, ISP, ASN, and network details for any IPv4/IPv6 address or domain name. It supports dual deployment on both **Cloudflare Workers** (edge) and a **Node.js VPS** managed by PM2.

---

## Features

- 🌍 **IP & Domain Lookup** — Resolve any IPv4, IPv6, or domain name to location data
- 🔍 **Auto-detect** — Opens with your own IP pre-resolved
- 🗺️ **Rich Geolocation** — City, region, country, coordinates, timezone, ISP, ASN
- 🌐 **Internationalization** — English, 简体中文, 繁體中文, 日本語
- 🎨 **Dark / Light Theme** — With OS-preference detection and `localStorage` persistence
- ⚡ **Rate Limiting** — Configurable per-route via `config/default.json`
- 🔄 **Auto DB Update** — Checks for DB updates daily from `sapics/ip-location-db`
- 🚀 **Cloudflare Workers** — Edge deployment at `ip.du.dev`
- 🖥️ **VPS / Node.js** — Managed by PM2 with MMDB-based lookups
- 📖 **API** — Clean JSON REST API with inline documentation

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Download IP databases
npm run update-db

# 3. Start dev server (hot-reload)
npm run dev
```

Open http://localhost:3000

---

## Configuration

All settings live in `config/default.json`:

| Key | Default | Description |
|-----|---------|-------------|
| `server.port` | `3000` | HTTP listener port |
| `server.host` | `0.0.0.0` | Bind address |
| `rateLimit.page.max` | `30` | Page requests / minute / IP |
| `rateLimit.api.max` | `60` | API requests / minute / IP |
| `rateLimit.*.windowMs` | `60000` | Rate limit window (ms) |
| `database.autoUpdate` | `true` | Enable scheduled DB updates |
| `database.checkIntervalMs` | `86400000` | Update check interval (24h) |
| `i18n.defaultLocale` | `en` | Default language |

---

## API Reference

### `GET /api/lookup`

Look up geolocation data for an IP address or domain.

**Query Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | No | IP address or domain. Omit to look up the client's own IP. |

**Example Requests**

```bash
# Client's own IP
curl https://ip.du.dev/api/lookup

# Specific IP
curl https://ip.du.dev/api/lookup?q=8.8.8.8

# Domain
curl https://ip.du.dev/api/lookup?q=github.com
```

**Example Response**

```json
{
  "ip": "8.8.8.8",
  "version": "IPv4",
  "city": "Mountain View",
  "region": "California",
  "country": "United States",
  "countryCode": "US",
  "continent": "NA",
  "lat": 37.386,
  "lon": -122.0838,
  "timezone": "America/Los_Angeles",
  "asn": "AS15169",
  "org": "Google LLC",
  "isp": "Google LLC",
  "source": "mmdb",
  "query": "8.8.8.8",
  "queryType": "ip"
}
```

### `GET /api/health`

Simple health check endpoint.

```json
{ "status": "ok", "timestamp": "2024-04-18T12:00:00.000Z" }
```

### Rate Limits

| Route | Default Limit |
|-------|---------------|
| `GET /` | 30 requests / minute / IP |
| `GET /api/*` | 60 requests / minute / IP |

Rate limit headers are returned on every response:
- `X-RateLimit-Limit` — Window maximum
- `X-RateLimit-Remaining` — Requests remaining
- `X-RateLimit-Reset` — Unix timestamp when window resets
- `Retry-After` — Seconds to wait (only on 429)

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Node.js server with hot-reload |
| `npm run dev:cf` | Start Cloudflare Workers local dev |
| `npm start` | Start Node.js server (production) |
| `npm run update-db` | Download / update MMDB databases |
| `npm run upload-r2` | Upload MMDB files to Cloudflare R2 |
| `npm run deploy:cf` | Deploy to Cloudflare Workers |

---

## Project Structure

```
ip-du/
├── config/
│   └── default.json       # Application configuration
├── data/                  # MMDB files (gitignored, downloaded at runtime)
├── deploy/
│   └── vps-deploy.sh      # VPS deployment script
├── scripts/
│   ├── update-db.js       # IP database downloader / updater
│   └── upload-r2.js       # R2 upload utility
├── src/
│   ├── middleware/
│   │   ├── client-ip.js   # Real IP extraction
│   │   ├── cors.js        # CORS headers
│   │   └── rate-limit.js  # Sliding-window rate limiter
│   ├── routes/
│   │   ├── api.js         # /api/* handlers
│   │   └── page.js        # Frontend SPA handler
│   ├── services/
│   │   ├── db.js          # Node.js MMDB service
│   │   ├── db-worker.js   # CF Workers DB service
│   │   └── lookup.js      # Shared lookup logic
│   ├── utils/
│   │   └── config.js      # Config loader
│   ├── views/
│   │   └── index.html     # Frontend SPA
│   ├── server.js          # Node.js entry point
│   └── worker.js          # Cloudflare Workers entry point
├── ecosystem.config.cjs   # PM2 configuration
├── wrangler.toml          # Cloudflare Workers configuration
└── DEPLOYMENT.md          # Deployment guide
```

---

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for step-by-step instructions for:
- Cloudflare Workers (`wrangler deploy`)
- VPS with PM2 (`ssh dm`)

---

## IP Database Attribution

IP geolocation data is provided by [DB-IP](https://db-ip.com) via the
[sapics/ip-location-db](https://github.com/sapics/ip-location-db) open-source project,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

---

## License

MIT © IP-Du Contributors
