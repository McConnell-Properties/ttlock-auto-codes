#!/bin/bash
# One-shot installer for the channel-manager scheduled jobs (launchd).
#
#   bash automation/install.sh            # install/refresh all jobs
#   bash automation/install.sh status     # show job status
#   bash automation/install.sh uninstall  # remove all jobs
#
# Jobs (all plain local node — no Claude needed).
# TIMING PRINCIPLE: the check-in chain (booking arrives → deposit paid → room
# confirmed → door code) is EVENT-DRIVEN — same-day bookings are common and
# guests expect instant turnaround. Polling jobs remain only as safety nets.
#
#   email-watch         always on      CHECK-IN CHAIN: IMAP IDLE — reacts the second
#                                      a Booking.com email arrives (cancellations
#                                      handled, detail-fetch queued, LH export +
#                                      TTLock pipeline triggered for that property)
#   reservation-import  on file change CHECK-IN CHAIN: WatchPaths fires the moment
#                                      the pipeline rewrites reservation_status.csv
#                                      (daily 15:40 kept as a backstop)
#   booking-emails      every 5 min    safety net behind email-watch
#   stripe-sync         every 5 min    safety net — payments confirm instantly via
#                                      the booking-site Stripe webhook
#   import-extras       every 15 min   safety net — extras land instantly via the
#                                      booking-site direct trigger
#   db-backup           daily 04:00    snapshot db (keeps newest 30)
#
# Rates are pulled MANUALLY when you change the Sheet:  npm run rates:pull
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(dirname "$HERE")"
RUN="$HERE/run-job.sh"
LA="$HOME/Library/LaunchAgents"
PREFIX="com.mcconnell.cm"
UID_NUM="$(id -u)"

chmod +x "$RUN" "$HERE/jobs/"*.sh

JOBS=(reservation-import email-watch booking-emails stripe-sync import-extras db-backup poll-ttlock-arrivals sync-inventory)

plist_path() { echo "$LA/$PREFIX.$1.plist"; }

unload_job() {
  launchctl bootout "gui/$UID_NUM" "$(plist_path "$1")" 2>/dev/null \
    || launchctl unload "$(plist_path "$1")" 2>/dev/null || true
}

status() {
  echo "Job status (PID  last-exit  label):"
  launchctl list | grep "$PREFIX" || echo "  (none installed)"
  echo
  echo "Last log lines:"
  for j in "${JOBS[@]}"; do
    f="$HERE/logs/$j.log"
    [ -f "$f" ] && echo "  [$j] $(tail -1 "$f")"
  done
}

if [ "${1:-}" = "status" ]; then status; exit 0; fi

if [ "${1:-}" = "uninstall" ]; then
  for j in "${JOBS[@]}"; do unload_job "$j"; rm -f "$(plist_path "$j")"; done
  echo "All $PREFIX jobs removed."
  exit 0
fi

mkdir -p "$LA" "$HERE/logs"

# one-time deps + migration for the booking-emails job (safe to re-run)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
( cd "$APP" \
  && { [ -d node_modules/imapflow ] || npm install --no-audit --no-fund; } \
  && node db/migrate-email-tasks.mjs )

# one-time deps for sync-inventory (Playwright + Chromium browser binary)
( cd "$APP" \
  && { [ -d node_modules/playwright ] || npm install --no-audit --no-fund playwright; } \
  && node_modules/.bin/playwright install chromium 2>/dev/null ) || true

# write_plist <name> <trigger-xml> <cmd...>
# <trigger-xml> is a complete plist fragment (its own <key>s), so jobs can mix
# StartCalendarInterval, WatchPaths, KeepAlive, etc.
write_plist() {
  local name="$1" trigger="$2"; shift 2
  local args=""
  for a in "$RUN" "$name" "$@"; do
    args+="    <string>$a</string>
"
  done
  cat > "$(plist_path "$name")" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PREFIX.$name</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  $trigger
  <key>StandardOutPath</key><string>$HERE/logs/$name.launchd.log</string>
  <key>StandardErrorPath</key><string>$HERE/logs/$name.launchd.log</string>
</dict>
</plist>
EOF
}

daily() { echo "<key>StartCalendarInterval</key><dict><key>Hour</key><integer>$1</integer><key>Minute</key><integer>$2</integer></dict>"; }

at() { # at <h1> <m1> <h2> <m2> ... — fires at each listed hour:minute
  local out="<key>StartCalendarInterval</key><array>"
  while [ $# -ge 2 ]; do out+="<dict><key>Hour</key><integer>$1</integer><key>Minute</key><integer>$2</integer></dict>"; shift 2; done
  echo "$out</array>"
}

every() { # every N minutes
  local out="<key>StartCalendarInterval</key><array>"
  for ((m = 0; m < 60; m += $1)); do out+="<dict><key>Minute</key><integer>$m</integer></dict>"; done
  echo "$out</array>"
}

# fire when a file changes (+ daily backstop, + small throttle so a burst of
# writes coalesces into one run — the job itself skips unchanged files)
watch_file() { # watch_file <path> <backstop-hour> <backstop-min>
  echo "<key>WatchPaths</key><array><string>$1</string></array><key>ThrottleInterval</key><integer>15</integer>$(daily "$2" "$3")"
}

# always-on daemon (restarts if it dies; ThrottleInterval stops crash-looping)
keepalive() {
  echo "<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer>"
}

# the reservation_status.csv the import job consumes (RESERVATION_STATUS_CSV in
# .env wins — keep in sync with jobs/reservation-import.sh)
RES_CSV="$( { sed -n 's/^[[:space:]]*RESERVATION_STATUS_CSV[[:space:]]*=[[:space:]]*"\{0,1\}\([^"]*\)"\{0,1\}[[:space:]]*$/\1/p' "$APP/.env" 2>/dev/null || true; } | tail -1)"
RES_CSV="${RES_CSV:-$HOME/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/automation-data/reservation_status.csv}"

# sentinel written by queue-inventory.mjs when jobs are enqueued (event-driven trigger)
SYNC_SENTINEL="$HERE/logs/.sync-inventory.trigger"

write_plist reservation-import   "$(watch_file "$RES_CSV" 15 40)"    /bin/bash "$HERE/jobs/reservation-import.sh"
write_plist email-watch          "$(keepalive)"                        node "$APP/db/watch-booking-emails.mjs"
write_plist booking-emails       "$(every 5)"                          node "$APP/db/poll-booking-emails.mjs"
write_plist stripe-sync          "$(every 5)"                          node "$APP/db/stripe-sync.mjs"
write_plist import-extras        "$(every 15)"                         node "$APP/db/import-extras.mjs"
write_plist db-backup            "$(daily 4 0)"                        node "$APP/db/backup.mjs"
write_plist poll-ttlock-arrivals "$(at 9 0 17 0)"                     /bin/bash "$HERE/jobs/poll-ttlock-arrivals.sh"
write_plist sync-inventory       "$(watch_file "$SYNC_SENTINEL" 6 0)" node "$APP/scripts/sync-inventory.mjs"

for j in "${JOBS[@]}"; do
  unload_job "$j"
  launchctl bootstrap "gui/$UID_NUM" "$(plist_path "$j")" 2>/dev/null \
    || launchctl load "$(plist_path "$j")"
done

echo "Installed ${#JOBS[@]} jobs to $LA"
echo
status
echo
echo "Notes:"
echo " - Jobs run only while the Mac is awake; daily jobs missed during sleep fire on next wake."
echo " - Rates: pull manually after editing the Sheet — npm run rates:pull"
echo "   (needs GOOGLE_SERVICE_ACCOUNT_JSON + RATES_SPREADSHEET_ID in $APP/.env)."
echo " - Logs: $HERE/logs/<job>.log    Run one now: launchctl kickstart gui/$UID_NUM/$PREFIX.<job>"
