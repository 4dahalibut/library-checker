#!/bin/sh
set -e

echo "[entrypoint] Starting..."
echo "[entrypoint] Checking /app/data directory..."

# Create data directory if it doesn't exist
mkdir -p /app/data

# If database doesn't exist in volume, copy from seed
if [ ! -f /app/data/library.db ]; then
  echo "[entrypoint] No database found in /app/data"
  if [ -f /app/seed-data/library.db ]; then
    echo "[entrypoint] Copying seed database to volume..."
    cp /app/seed-data/library.db /app/data/library.db
    echo "[entrypoint] Database copied successfully"
  else
    echo "[entrypoint] WARNING: No seed database found at /app/seed-data/library.db"
  fi
else
  echo "[entrypoint] Database already exists in /app/data"
fi

echo "[entrypoint] Listing /app/data:"
ls -la /app/data

echo "[entrypoint] Starting Node.js server..."
exec node dist/server.js
