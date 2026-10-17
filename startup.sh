#!/bin/sh
# Restart contract for this project: bring the Lightcraft studio back up.
# Idempotent — it exits immediately when something already answers on :8080.
set -eu
cd "$(dirname "$0")"

if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi

# `npm run dev` is the only supported entrypoint: it loads .grok/app-env.json.
nohup npm run dev >>dev-server.log 2>&1 &
