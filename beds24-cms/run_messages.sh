#!/bin/bash
# Poll Beds24 for new guest messages and rebuild the inbox. Lightweight; safe to
# run every few minutes. Read-only.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p logs
LOG="logs/messages-$(date +%Y%m%d).log"
PY="${BEDS24_PYTHON:-python3}"

{
  echo "--- poll $(date '+%H:%M:%S') ---"
  "$PY" messages_fetch.py "$@"
  "$PY" build_messages_dashboard.py
  # Optional: deploy the inbox to your CMS (same hook style as run.sh)
  if [ -n "${MESSAGES_DEPLOY_CMD:-}" ]; then
    echo "Deploying inbox: $MESSAGES_DEPLOY_CMD"
    eval "$MESSAGES_DEPLOY_CMD"
  fi
} >> "$LOG" 2>&1

echo "OK — messages-dashboard.html rebuilt. Log: $LOG"
