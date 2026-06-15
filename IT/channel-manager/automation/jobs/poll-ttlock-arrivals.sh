#!/bin/bash
# Poll TTLock unlock records for in-stay guests; update CrmRecord.arrivedDetected.
# Runs via launchd every 20 minutes (see install.sh).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(dirname "$(dirname "$HERE")")"
node "$APP/db/poll-ttlock-arrivals.mjs"
