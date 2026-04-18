# Deployment Guide

## Overview

IP-Du supports two deployment targets:

| Target | Platform | Domain |
|--------|----------|--------|
| **Edge** | Cloudflare Workers | `ip.du.dev` |
| **VPS** | Node.js + PM2 | Custom (reverse-proxy via Nginx/Caddy) |

---

## Prerequisites

```bash
# Node.js >= 20
node --version

# Wrangler CLI (Cloudflare)
npx wrangler --version

# PM2 (on VPS)
pm2 --version
```

---

## 1. Local Development

```bash
git clone https://github.com/du-sonnedu/ip-du.git
cd ip-du

npm install
npm run update-db   # Download MMDB files (~140MB total)
npm run dev         # Start at http://localhost:3000
```

---

## 2. Cloudflare Workers Deployment

### 2.1 Authenticate with Cloudflare

```bash
npx wrangler login
```

### 2.2 Create R2 Bucket (one-time)

```bash
npx wrangler r2 bucket create ip-du-db
```

### 2.3 Upload MMDB databases to R2

```bash
npm run update-db    # Download fresh MMDB files
npm run upload-r2    # Upload to R2
```

### 2.4 Configure Custom Domain in wrangler.toml

`wrangler.toml` already contains:
```toml
[[routes]]
pattern   = "ip.du.dev/*"
zone_name = "du.dev"
```

Make sure `du.dev` is active in your Cloudflare account and IP-Du is being deployed to the same account.

### 2.5 Deploy

```bash
npm run deploy:cf
# Alias for: npx wrangler deploy
```

The Worker will be live at `https://ip.du.dev`.

### 2.6 Update Rate Limits (optional)

Override rate limits via Cloudflare Dashboard:
**Workers & Pages → ip-du → Settings → Variables & Secrets**

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_PAGE_WINDOW` | `60000` | Window in ms |
| `RATE_LIMIT_PAGE_MAX` | `30` | Max page reqs/window |
| `RATE_LIMIT_API_WINDOW` | `60000` | Window in ms |
| `RATE_LIMIT_API_MAX` | `60` | Max API reqs/window |

### 2.7 Test

```bash
# Remote
curl https://ip.du.dev/api/lookup
curl https://ip.du.dev/api/lookup?q=8.8.8.8
curl https://ip.du.dev/api/health

# Local Workers dev
npx wrangler dev src/worker.js
curl http://localhost:8787/api/lookup
```

---

## 3. VPS Deployment (Node.js + PM2)

> The VPS is accessible via `ssh dm`. App lives at `/www/ip-du`.

### 3.1 First-Time Setup on VPS

```bash
ssh dm

# Install Node.js 20+ (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2 globally
npm install -g pm2

# Clone the repository
mkdir -p /www
cd /www
git clone https://github.com/du-sonnedu/ip-du.git ip-du
cd ip-du

# Install dependencies
npm install --omit=dev

# Download MMDB databases
npm run update-db

# Create log directory
mkdir -p logs

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save

# Auto-start on reboot
pm2 startup
# (Run the command printed by pm2 startup)
```

### 3.2 Nginx Reverse Proxy (recommended)

```nginx
# /etc/nginx/sites-available/ip-du
server {
    listen 80;
    server_name your.domain.com;

    # Pass real client IP to Node.js
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host              $host;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

Enable with:
```bash
ln -s /etc/nginx/sites-available/ip-du /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 3.3 Update Deployments

**From your local machine:**

```bash
# Push changes to GitHub
git push origin main

# Deploy to VPS
ssh dm "bash /www/ip-du/deploy/vps-deploy.sh"
```

The deploy script:
1. `git pull --ff-only` — fetches latest code
2. `npm install --omit=dev` — installs/updates dependencies
3. `node scripts/update-db.js` — checks for DB updates
4. `pm2 reload ecosystem.config.cjs` — zero-downtime reload

### 3.4 PM2 Management Commands

```bash
# On VPS
pm2 status ip-du           # View process info
pm2 logs ip-du             # Stream logs
pm2 logs ip-du --lines 100 # Last 100 lines
pm2 restart ip-du          # Hard restart
pm2 reload ip-du           # Zero-downtime restart
pm2 stop ip-du             # Stop
pm2 delete ip-du           # Remove from PM2

# Update databases manually
cd /www/ip-du && npm run update-db
```

### 3.5 Rate Limit Configuration (VPS)

Edit `/www/ip-du/config/default.json` on the VPS:

```json
{
  "rateLimit": {
    "page": { "windowMs": 60000, "max": 30 },
    "api":  { "windowMs": 60000, "max": 60 }
  }
}
```

Then reload: `pm2 reload ip-du`

---

## 4. GitHub Actions (Optional CI/CD)

To auto-deploy on push to `main`, create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-cf:
    runs-on: ubuntu-latest
    name: Cloudflare Workers
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run deploy:cf
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}

  deploy-vps:
    runs-on: ubuntu-latest
    name: VPS
    steps:
      - name: SSH deploy
        uses: appleboy/ssh-action@v1
        with:
          host:     ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key:      ${{ secrets.VPS_SSH_KEY }}
          script:   bash /www/ip-du/deploy/vps-deploy.sh
```

Add secrets in **GitHub → Settings → Secrets and variables → Actions**:
- `CF_API_TOKEN` — Cloudflare API token with Worker deploy permissions
- `VPS_HOST` — VPS IP or hostname
- `VPS_USER` — SSH username
- `VPS_SSH_KEY` — Private SSH key

---

## 5. Database Update Schedule

The Node.js server automatically checks for database updates every 24 hours (configurable via `database.checkIntervalMs` in `config/default.json`). The databases are sourced from [sapics/ip-location-db](https://github.com/sapics/ip-location-db) which updates monthly.

To manually trigger an update:
```bash
npm run update-db           # Local
ssh dm "cd /www/ip-du && npm run update-db && pm2 reload ip-du"   # VPS
```

For Cloudflare Workers, re-upload to R2 after updating:
```bash
npm run update-db && npm run upload-r2 && npm run deploy:cf
```
