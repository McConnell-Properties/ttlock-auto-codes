#!/bin/bash
# Run the Little Hotelier export for one or more properties RIGHT NOW —
# called by poll-booking-emails.mjs the moment a Booking.com email lands,
# instead of waiting for the daily pipeline run.
#
#   trigger-export.sh streatham [tooting ...]
#
# Each export drops check_in_{property}_{date}.csv into the TTLock pipeline's
# automation-data/inputs/, whose own launchd WatchPaths job then runs the full
# pipeline (Stripe links, door codes, reservation_status.csv) — and THAT file
# is watched by reservation-import. So one booking email cascades, hands-free:
#   email → export → pipeline → door code + reservation import. All instant.
set -u

PIPELINE_ROOT="${TTLOCK_PIPELINE_ROOT:-$HOME/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$HERE/../logs/trigger-export.log"
LOCK="$PIPELINE_ROOT/logs/export-trigger.lock"
mkdir -p "$(dirname "$LOG")" "$PIPELINE_ROOT/logs"
exec >> "$LOG" 2>&1

[ $# -ge 1 ] || { echo "$(date '+%F %T') usage: trigger-export.sh <property> [property...]"; exit 1; }

if [ ! -f "$PIPELINE_ROOT/run_export.sh" ]; then
  echo "$(date '+%F %T') run_export.sh not found in $PIPELINE_ROOT — set TTLOCK_PIPELINE_ROOT in .env"
  exit 1
fi

# Serialize exports (shared Playwright session store). Wait up to 15 min for
# a running export to finish; clear locks older than 30 min (crashed run).
waited=0
while ! mkdir "$LOCK" 2>/dev/null; do
  if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    echo "$(date '+%F %T') clearing stale lock (>30 min)"
    rmdir "$LOCK" 2>/dev/null || rm -rf "$LOCK"
    continue
  fi
  if [ "$waited" -ge 900 ]; then
    echo "$(date '+%F %T') gave up waiting for lock after 15 min — properties: $*"
    exit 1
  fi
  sleep 10; waited=$((waited + 10))
done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

for prop in "$@"; do
  echo "$(date '+%F %T') export triggered for: $prop"
  PROPERTY_NAME="$prop" bash "$PIPELINE_ROOT/run_export.sh"
  rc=$?
  echo "$(date '+%F %T') export for $prop exited $rc"
done
echo "$(date '+%F %T') done — pipeline will fire via its inputs/ WatchPaths"
