#!/bin/sh
set -e

echo "[entrypoint] Starting..."
echo "[entrypoint] Checking /app/data directory..."

# Create data directory if it doesn't exist
mkdir -p /app/data

# Check seed database
if [ -f /app/seed-data/library.db ]; then
  SEED_SIZE=$(stat -c%s /app/seed-data/library.db 2>/dev/null || stat -f%z /app/seed-data/library.db)
  echo "[entrypoint] Seed database size: $SEED_SIZE bytes"

  if [ -f /app/data/library.db ]; then
    VOLUME_SIZE=$(stat -c%s /app/data/library.db 2>/dev/null || stat -f%z /app/data/library.db)
    echo "[entrypoint] Volume database size: $VOLUME_SIZE bytes"

    if [ "$SEED_SIZE" -gt "$VOLUME_SIZE" ]; then
      echo "[entrypoint] Seed is larger, copying to volume..."
      cp /app/seed-data/library.db /app/data/library.db
      echo "[entrypoint] Database updated from seed"
    else
      echo "[entrypoint] Volume database is same size or larger, keeping it"
    fi
  else
    echo "[entrypoint] No database in volume, copying seed..."
    cp /app/seed-data/library.db /app/data/library.db
    echo "[entrypoint] Database copied successfully"
  fi
else
  echo "[entrypoint] WARNING: No seed database found"
fi

echo "[entrypoint] Listing /app/data:"
ls -la /app/data

echo "[entrypoint] Starting Node.js server..."
exec node dist/server.js
