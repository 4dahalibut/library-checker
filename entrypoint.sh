#!/bin/sh
set -e

echo "[entrypoint] Starting..."
exec node dist/server.js
