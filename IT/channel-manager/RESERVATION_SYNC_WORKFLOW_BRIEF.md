# Build brief — Wire reservation sync into the workflow (availability → BDC, promptly)

**Goal:** every change that alters availability — a new booking (direct or OTA), a cancellation, a manual block, a delete — should recompute `rooms-to-sell` for the affected room-type/dates, enqueue the channel push, and **fire `sync-inventory` promptly**, so BDC's availability tracks Turso and a direct booking can't oversell. The push *engine* (`scripts/sync-inventory.mjs`, Playwright + queue) already exists; this brief is the **trigger wiring**.

**Repo:** `channel-manager`. Turso is SoT. Additive/safe; go-live guardrails (canary, parallel-run with the old pipeline, dedupe by `channelRef`) still apply.

## How it works today
- `db/queue-inventory.mjs` recomputes `rooms-to-sell`, writes/replaces `SyncJob` rows, and **touches `automation/logs/.sync-inventory.trigger`**.
- A launchd job (`sync-inventory`, WatchPaths on that sentinel + a 06:00 backstop) fires `scripts/sync-inventory.mjs`, which drains pending `SyncJob`s and pushes to the BDC extranet.
- **Gap:** the per-booking paths (`db/book-cli.mjs`, `createBookingWithSync`, cancellations, blocks) write `SyncJob` rows but **don't touch the sentinel**, so the push waits for the 06:00 backstop. That lag is the oversell window.

## 1. One chokepoint helper
Add `enqueueAndTrigger(roomTypeId, fromDate, toDate)` (extract the recompute + sentinel-touch core from `queue-inventory.mjs`, don't duplicate it). It recomputes affected dates' `rooms-to-sell`, upserts `SyncJob`s for the channels that need it, and touches the sentinel. Every mutation calls this one function.

## 2. Wire it into every availability-changing mutation
- **`createBookingWithSync`** (direct + admin) → call it for the booking's room-type/date span. **This is the critical one** for opening direct without overselling BDC.
- **`book-cli.mjs`** (OTA email imports) → call it after insert. (A booking.com booking needs no BDC push — origin already knows — but does need Expedia later; the helper handles channel selection.)
- **`cancelBooking`** + the **cancellation path in `poll-booking-emails.mjs`** → recompute restores availability, enqueue, trigger.
- **Block add/remove** and **manual booking delete** → same.
- A **move within the same room type** doesn't change the count — skip it. A move **across** types, or a block, does — trigger it.
Channel logic: **skip the origin channel**; Expedia is off for now, so in practice this is booking.com pushes only.

## 3. The cross-host wrinkle (important)
The **deployed admin runs on Vercel (cloud)** — it can write `SyncJob`s to Turso but **cannot touch the Mac's sentinel file**. So the sentinel only fires for **Mac-originated** mutations (`book-cli`, local scripts). For **cloud-originated** mutations (a **direct booking via the deployed admin/booking-site**), the Mac never gets the wake-up.

Close it with a **short queue-drain interval on the Mac**: run `sync-inventory` every **~2 minutes** (in addition to the sentinel), draining any pending `SyncJob`s. The data path already works — cloud writes the jobs to Turso, the Mac reads them — only the *trigger* was missing. The sentinel gives instant response for local changes; the 2-min interval covers cloud-origin ones. **That interval is your maximum oversell window — keep it small (≤2–3 min).**

## 4. Health + safety (don't fail silently)
- If `sync-inventory` can't run (session expired, a login challenge, the `.bdc-profile` logged out), it must **leave the jobs `pending`** (so the next run retries) and **alert you** — never mark done or drop. A silent stall = BDC drifting out of sync = oversell risk.
- Keep the existing per-run lock (no overlapping pushes) and `done`/`failed` marking.

## Tests (report PASS/FAIL; canary on one real booking first)
1. **Direct booking** via the admin → within ~2 min, BDC `rooms-to-sell` for that type/date drops by one (verify on the extranet or the job marked done).
2. **Cancellation** → availability restored and re-pushed.
3. **Local `book-cli` import** → sentinel fires the push within seconds.
4. **Block added** → push reflects it; removed → restored.
5. **Failure mode:** force a logged-out `.bdc-profile` → jobs stay `pending`, an alert fires, nothing marked done.
6. **Concurrency:** two direct bookings of the same type/date in quick succession → no oversell (queue serializes; second sees the decremented count).
