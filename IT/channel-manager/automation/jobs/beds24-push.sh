#!/bin/bash
# Outbound drainer: consume pending BDC SyncJob rows and push to Beds24.
# Runs every 10 min via launchd. Dry-run by default unless BEDS24_PUSH_DRYRUN=0.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(dirname "$(dirname "$HERE")")"

BEDS24_PUSH_DRYRUN=0 node "$APP/db/beds24-push.mjs"
