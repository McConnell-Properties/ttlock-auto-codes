#!/bin/bash
# Wrapper that launchd calls for every channel-manager job.
# Usage: run-job.sh <job-name> <command...>
# - cds into the channel-manager folder
# - loads .env (so node scripts get STRIPE_SECRET_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, etc.)
# - timestamps + logs output to automation/logs/<job-name>.log (kept under ~1MB)
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(dirname "$HERE")"
JOB="${1:?job name required}"; shift

LOGDIR="$HERE/logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$JOB.log"

# launchd has a bare PATH; make sure node/npm are findable
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# load .env (simple KEY=value / KEY="value" lines; existing env wins)
if [ -f "$APP/.env" ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*([A-Z_][A-Z0-9_]*)[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?[[:space:]]*$ ]] || continue
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    [ -z "${!key:-}" ] && export "$key=$val"
  done < "$APP/.env"
fi

# rotate log if it's grown past ~1MB
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  mv "$LOG" "$LOG.old"
fi

cd "$APP"
{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') $JOB: $*"
  "$@" 2>&1
  rc=$?
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') $JOB: exit $rc"
  exit $rc
} >> "$LOG" 2>&1
