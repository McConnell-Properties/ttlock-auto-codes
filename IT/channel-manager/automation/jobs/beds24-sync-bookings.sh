#!/bin/bash
# Bidirectional hub↔Beds24 booking mirror.
# Runs ~every 10 min; stamps beds24Id from load log, pushes new direct bookings,
# modifies drifted bookings, cancels cancelled ones.  Origin rule prevents
# re-pushing native BDC/Airbnb bookings.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(dirname "$(dirname "$HERE")")"

node "$APP/db/beds24-sync-bookings.mjs"
