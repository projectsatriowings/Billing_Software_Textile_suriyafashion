#!/bin/bash
set -e

echo "🚀 [Deploy] Pulling latest changes from main..."
git pull origin main

echo "📦 [Deploy] Installing dependencies..."
npm install

echo "🔨 [Deploy] Building client bundle..."
npm run build

echo "🔄 [Deploy] Reloading PM2 process..."
pm2 reload textilebilling --update-env 2>/dev/null || pm2 restart textilebilling --update-env

echo "⏳ [Deploy] Verifying server health..."
PORT=${PORT:-5023}
for i in {1..15}; do
  if curl -s "http://127.0.0.1:${PORT}/api/health" | grep -q '"ok":true'; then
    echo "✅ [Deploy] Server is live and healthy on port ${PORT}! No 502 Bad Gateway."
    exit 0
  fi
  sleep 1
done

echo "⚠️ [Deploy] Server took longer than expected to start. Please check 'pm2 logs textilebilling'."
