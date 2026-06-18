# Beds24 Channel Dashboard (read-only)

A self-contained reporting system that pulls data from the **Beds24 API V2** and
builds a local dashboard. It is **read-only by design**: the API token uses
read-only scopes and the code issues only `GET` requests, so it can never push,
edit, or cancel anything in Beds24.

## What it does

- Pulls **properties, rooms, bookings and availability** into a local SQLite DB.
- Computes **occupancy, ADR, RevPAR, channel mix, booking pace vs last year, lead time**.
- Renders a single **`dashboard.html`** with four views:
  Occupancy & Calendar · Revenue & RevPAR · Bookings Feed · Pace & Pickup.
- Runs itself every morning via `launchd` — no babysitting, no approvals.

## Why it runs on your Mac

The Beds24 API is only reachable from your machine (not from Claude's sandbox),
so the fetcher lives here alongside your existing reservation pipeline. Once the
`launchd` job is loaded it runs unattended.

## One-time setup

1. **First-time token exchange** (swaps your 24h invite code for a permanent
   refresh token, stored in `secrets.json`, never committed):

   ```bash
   cd ~/ttlock-auto-codes/beds24-cms
   python3 beds24_client.py setup "<YOUR_INVITE_CODE>"
   ```

2. **First data pull + dashboard build:**

   ```bash
   ./run.sh
   open dashboard.html
   ```

3. **Schedule the daily 06:30 run:**

   ```bash
   cp com.mcconnell.beds24.daily.plist ~/Library/LaunchAgents/
   launchctl unload ~/Library/LaunchAgents/com.mcconnell.beds24.daily.plist 2>/dev/null
   launchctl load   ~/Library/LaunchAgents/com.mcconnell.beds24.daily.plist
   ```

   To stop it: `launchctl unload ~/Library/LaunchAgents/com.mcconnell.beds24.daily.plist`

## Manual run any time

```bash
./run.sh                       # default: 365 days back, 365 forward
./run.sh --days-back 730       # custom window
./run.sh --skip-availability   # faster; skip the per-room calendar pull
```

## Files

| File | Purpose |
|------|---------|
| `beds24_client.py` | Token lifecycle + read-only GET helpers |
| `fetch.py` | Pulls data → `data/beds24.db` (+ raw JSON in `raw/`) |
| `metrics.py` | Occupancy / ADR / RevPAR / channel / pace maths |
| `build_dashboard.py` | Renders `dashboard.html` |
| `run.sh` | fetch + build, logs to `logs/` |
| `com.mcconnell.beds24.daily.plist` | launchd schedule |
| `vendor/chart.umd.js` | Charting lib, vendored — dashboard works fully offline |
| `tests/` | Metric unit tests + mock-data generator |

## Testing

```bash
python3 tests/test_metrics.py   # known-input maths checks (no network)
python3 tests/make_mock.py      # builds tests/mock.db for an offline preview
```

## Notes on accuracy

`fetch.py` saves the **raw API responses** in `raw/` as well as the parsed DB.
Beds24 field names vary slightly by account; the parser reads tolerantly, and the
raw files let us reconcile exact shapes after the first live pull. Cross-check a
couple of numbers (e.g. this-month occupancy) against the Beds24 control panel on
day one to confirm the pipeline.

**Active bookings** (counted toward revenue/occupancy) default to `confirmed` and
`new`; `cancelled` and `black` (owner blocks) are excluded. Adjust `ACTIVE_STATUSES`
in `metrics.py` if your account uses different status labels.

## Guest messages inbox (Booking.com + Expedia)

A second, read-only feature: pull OTA guest messages and surface an
**unanswered-first inbox**. Uses the same token (the `bookings-personal` scope
already covers `GET /bookings/messages`) — no new setup.

```bash
bash run_messages.sh            # pull messages + rebuild messages-dashboard.html
open messages-dashboard.html
```

- `messages_fetch.py` pulls messages (via `GET /bookings` with messages embedded,
  falling back to `GET /bookings/messages`), stores them in the `messages` table.
- `messages_inbox.py` builds threads and flags **unanswered** ones (last message is
  from the guest). `build_messages_dashboard.py` renders the self-contained inbox.
- A thread is unanswered when, ignoring internal notes/system messages, the latest
  message is inbound. Threads sort unanswered-first, longest-waiting at the top.

### Near-real-time polling (every 5 minutes)

```bash
cp com.mcconnell.beds24.messages.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.mcconnell.beds24.messages.plist
```

Beds24's API is poll-based, so 5-minute polling is the practical "immediate."
(True push would need a webhook receiver — can be added later if you want it.)

Embed the inbox in your CMS the same way as the reports dashboard
(`messages-dashboard.html` is self-contained); see `CMS_INTEGRATION.md`.
Set `MESSAGES_DEPLOY_CMD` for the poller to push it to a remote CMS.
