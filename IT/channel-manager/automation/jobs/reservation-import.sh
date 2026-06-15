#!/bin/bash
# Daily re-import of the TTLock pipeline's reservation_status.csv.
# Source path: RESERVATION_STATUS_CSV in .env, else the pipeline's default export.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(dirname "$(dirname "$HERE")")"

CANDIDATES=(
  "${RESERVATION_STATUS_CSV:-}"
  "$HOME/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/automation-data/reservation_status.csv"
  "$HOME/ttlock-auto-codes/automation-data/reservation_status.csv"
)
CSV=""
for c in "${CANDIDATES[@]}"; do
  [ -n "$c" ] && [ -f "$c" ] && CSV="$c" && break
done
if [ -z "$CSV" ]; then
  echo "reservation_status.csv not found. Looked in:"
  printf '  %s\n' "${CANDIDATES[@]}"
  echo "Set RESERVATION_STATUS_CSV in $APP/.env to the correct path."
  exit 1
fi

# Skip if the file hasn't changed since the last successful import
STAMP="$HERE/../logs/.reservation-import.last"
CUR="$(stat -f '%m %z' "$CSV" 2>/dev/null || echo unknown)"
if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$CUR" ]; then
  echo "source unchanged ($CSV) — skipping"
  exit 0
fi

node "$APP/db/import-reservation-status.mjs" "$CSV" || exit $?
echo "$CUR" > "$STAMP"
