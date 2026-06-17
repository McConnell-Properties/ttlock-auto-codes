#!/bin/bash
# Safety-net poll: pulls Beds24 bookings modified since the last run and writes
# them to the live Booking table. The webhook handles real-time; this catches
# anything missed during downtime or webhook failures.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(dirname "$(dirname "$HERE")")"

node "$APP/db/beds24-pull.mjs"
