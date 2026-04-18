#!/usr/bin/env bash
# deploy/vps-deploy.sh
# Deployment script for the VPS (ssh dm "bash /www/ip-du/deploy/vps-deploy.sh")
#
# Prerequisites on VPS:
#   - git, node >= 20, npm, pm2 installed
#   - /www/ip-du is the git clone of the repo
#   - pm2 process 'ip-du' is already started (first-time: pm2 start ecosystem.config.cjs)
#
# Usage:
#   From local machine: ssh dm "bash /www/ip-du/deploy/vps-deploy.sh"
#   Or set up GitHub Actions to call this automatically.

set -euo pipefail
APP_DIR="/www/ip-du"
LOG_DIR="$APP_DIR/logs"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " IP-Du VPS Deploy — $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$APP_DIR"

# 1. Pull latest code
echo "▶ Pulling latest code…"
git pull --ff-only

# 2. Install production dependencies
echo "▶ Installing dependencies…"
npm install --omit=dev --prefer-offline

# 3. Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# 4. Update IP databases (only if changed)
echo "▶ Checking for IP database updates…"
node scripts/update-db.js

# 5. Reload app via PM2 (zero-downtime)
echo "▶ Reloading PM2 process…"
pm2 reload ecosystem.config.cjs --update-env

echo ""
echo "✅ Deploy complete!"
pm2 status ip-du
