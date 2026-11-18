#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
echo "New Raja Transport: open http://localhost:3000"
echo "Keep this terminal open; press Ctrl+C to stop."
exec node server.js
