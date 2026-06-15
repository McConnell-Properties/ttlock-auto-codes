# Channel-manager automation

Local jobs (launchd) that keep the channel manager self-feeding.
No Claude or browser needed — plain node scripts.

**Design rule: the check-in chain is EVENT-DRIVEN.** Same-day bookings are
common; a guest who books at 4pm needs deposit link, room and door code in
minutes, not at tomorrow's batch. Timed polls remain only as safety nets.

## Install / manage

```bash
bash automation/install.sh            # install or refresh all jobs
bash automation/install.sh status     # PIDs, last exit codes, last log lines
bash automation/install.sh uninstall  # remove everything
```

## The jobs

| Job | When | What |
|---|---|---|
| email-watch | **always on** (IMAP IDLE) | Reacts the **second** a Booking.com email arrives: runs the poller below, which also kicks the Little Hotelier export → TTLock pipeline for that property (`jobs/trigger-export.sh`). Booking → door code in minutes. |
| reservation-import | **instant** (WatchPaths) | Fires the moment the pipeline rewrites `reservation_status.csv`; daily 15:40 kept as backstop. Skips if unchanged. |
| booking-emails | every 5 min (safety net) | Same script email-watch runs. **Cancellations**: booking marked cancelled + inventory restore queued automatically. **New/modified**: detail-fetch task recorded with the direct extranet link (`node db/email-tasks-cli.mjs list`). |
| stripe-sync | every 5 min (safety net) | Payments confirm **instantly** via the booking-site Stripe webhook (`/api/stripe-webhook` — extras, direct bookings, phone-booking links). This poll just catches anything the webhook missed. |
| import-extras | every 15 min (safety net) | Extras land **instantly** — the booking-site triggers this import the moment a request is created or paid. |
| db-backup | daily 04:00 | Snapshots `db/dev.db` to `db/backups/` (keeps newest 30). |

Jobs run only while the Mac is awake. Daily jobs missed during sleep fire once on next wake.

**Instant chain for a new OTA booking:** email arrives → email-watch → poller
records it + `trigger-export.sh <property>` → export CSV lands in the
pipeline's `inputs/` → the pipeline's own WatchPaths job runs it (Stripe link,
door code, `reservation_status.csv`) → reservation-import WatchPaths
re-imports here. No step waits on a clock. Disable the export kick with
`EXPORT_TRIGGER=off` in .env; override the pipeline location with
`TTLOCK_PIPELINE_ROOT`.

**Rates are manual by design**: edit the Google Sheet, then run `npm run rates:pull`
(pulls + imports + queues OTA price sync jobs).

**The inventory queue still needs pushing**: booking-emails *queues* the
inventory changes instantly; applying them on the BDC/Expedia extranets is the
browser step (sync queue page, or a Claude in Chrome session / scheduled task).

## Config (.env in the app root)

- `RESERVATION_STATUS_CSV` — override the pipeline export path if it moves.
  Default: `~/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/automation-data/reservation_status.csv`
- `GOOGLE_SERVICE_ACCOUNT_JSON` + `RATES_SPREADSHEET_ID` — **required for rates-pull**;
  copy from the TTLock pipeline's credentials.
- `STRIPE_SECRET_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` — already set.
- `TTLOCK_PIPELINE_ROOT` — pipeline repo location if it ever moves
  (default `~/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes`).
- `EXPORT_TRIGGER=off` — stops booking emails kicking the LH export/pipeline.

## Logs & debugging

- `automation/logs/<job>.log` — timestamped output of every run.
- Run a job immediately: `launchctl kickstart gui/$(id -u)/com.mcconnell.cm.<job>`

## Not handled here (Cowork scheduled tasks — need the browser)

OTA extranet pushes (`SyncJob` queue) and BDC email→booking import run as
Claude/Cowork scheduled tasks since they drive a browser. They only run while
the Mac is awake with Claude open.
