#!/bin/bash
# Daily Beds24 pull + dashboard rebuild. Safe to run any time; read-only.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p logs
LOG="logs/run-$(date +%Y%m%d).log"

# Use python3 from PATH; override with BEDS24_PYTHON if you use a venv.
PY="${BEDS24_PYTHON:-python3}"

{
  echo "=== run $(date '+%Y-%m-%d %H:%M:%S') ==="
  "$PY" fetch.py "$@"
  "$PY" build_dashboard.py
  # Also build a single, dependency-free file for CMS embedding.
  "$PY" build_dashboard.py --inline --out dashboard-embed.html
  # Optional deploy step: set DEPLOY_CMD to push the file to your CMS server.
  # e.g. export DEPLOY_CMD='scp dashboard-embed.html user@cms:/var/www/app/beds24.html'
  if [ -n "${DEPLOY_CMD:-}" ]; then
    echo "Deploying: $DEPLOY_CMD"
    eval "$DEPLOY_CMD"
  fi
  echo "=== done $(date '+%H:%M:%S') ==="
} >> "$LOG" 2>&1

echo "OK — dashboard.html + dashboard-embed.html rebuilt. Log: $LOG"
