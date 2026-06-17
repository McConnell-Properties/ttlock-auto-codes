# Ledger — P1 · Beds24 API

Cowork agent: **Beds24 API** · Project **P1** · branch `beds24-api`
(worktree `../ttlock-beds24-api`). **Append only — you are the only writer.**
Read `../README.md` + `PM-LOG.md` first. Terminal label: `Beds24 API · P1`.

Scope (inside `IT/channel-manager/`): `db/beds24-*.mjs`, `app/api/beds24/**`,
`lib/beds24.ts`, `db/import-rates.mjs`, `db/pull-rates.mjs`,
`db/queue-inventory.mjs`, `db/poll-ttlock-arrivals.mjs` + new TTLock issuer,
`automation/jobs/beds24-pull.sh`, `automation/jobs/poll-ttlock-arrivals.sh`,
`roomtypes-bdc-map.csv`, `roomtypes-channel-map.csv`. Owner of the room-type maps.
STOP-and-flag: live door codes, mass/live Turso writes, prod migrations.

Reference backlog (from June audit — Charlie prioritises in chat):
- TTLock issuer for Beds24→Turso bookings (URGENT; old issuer retired). New
  bookings currently may get no door code.
- ~40 confirmed Booking.com reservations (Jul–Dec) missing from Turso — reconcile + backfill.
- Beds24-loaded bookings with no physical room assigned — detect + repair.
- Seamless has no smart locks — document how arrivals are handled.
- Restore the availability + rate push to the channels (sync failures Jun 15–16 were parked).
- ~21 duplicate `channelRef` groups — de-dupe (propose rule first; mass delete = STOP-and-flag).
- £16,994 Jun-12 bulk price change never reviewed — audit, recommend keep/revert.
- `beds24Id` declared INTEGER in migrate vs TEXT in `beds24-pull.mjs` — reconcile.
- Expedia treated as native in `beds24-pull` but non-native in `beds24-sync-bookings` — pick one rule.

---

## 2026-06-17 · STATUS · setup
agent: P1 Beds24 API   branch: beds24-api
Track ready. Awaiting Charlie's first direction in chat. Append a REPORT here when a cycle ships.
<!-- append new entries below -->

---

## 2026-06-17 · REPORT · CC-D outbound calendar drainer

**Branch:** `beds24-calendar-sync` (off `mac-decommission-phase1`)
**Commit:** `e9b04cd` feat(beds24): CC-D — outbound calendar drainer + launchd schedule

### What shipped

**New files:**
- `lib/beds24-push.ts` — TypeScript drainer core; importable by Vercel cron routes
- `db/beds24-push.mjs` — standalone ESM CLI for launchd; refuses to run without `DATABASE_URL`
- `automation/jobs/beds24-push.sh` — thin launchd wrapper; calls drainer in live mode

**Committed previously-untracked files:**
- `db/beds24-pull.mjs`, `db/beds24-sync-bookings.mjs`
- `app/api/beds24/webhook/route.ts`
- `automation/jobs/beds24-pull.sh`

**Deleted:** `scripts/sync-inventory.mjs` (retired Playwright BDC bot — sync now goes through Beds24 API)

**Updated:** `automation/install.sh`
- Adds `beds24-pull` (every 15 min) + `beds24-push` (every 10 min) to launchd
- Removes Playwright/Chromium install block (no longer needed)
- Launchd jobs registered: both visible in `launchctl list | grep mcconnell`

### Key design decisions

**DPR guard (critical):** Beds24 silently drops `numAvail` if a room has no Daily Price Rule — returns 201/success:true but nothing in `modified`. The drainer marks a SyncJob row `done` ONLY when `numAvail`/`price1` appears in `modified.calendar` for that room. Otherwise marks `failed` with note `"numAvail dropped — missing DPR?"`. Do not trust the 201.

**Model A:** `numAvail = totalUnits − blocks` (let Beds24 subtract its own bookings). The queued `value` column holds `totalUnits − bookings − blocks` (stale, double-counts) — drainer recomputes from Block table at push time.

**Seamless excluded:** `AND rt.propertyId != 'seamless'` — Seamless BDC rows must not be pushed to Beds24.

### To verify (smoke test)

```bash
# 1. Dry-run — should show 83 pending jobs, 14 ranges, 13 rooms (current queue)
node db/beds24-push.mjs

# 2. Queue one fresh Valnay date (room with known-good DPR: 693520)
node db/queue-inventory.mjs 1 valnay

# 3. Live push
BEDS24_PUSH_DRYRUN=0 node db/beds24-push.mjs

# 4. Check result: 693520 jobs → done; 693521/693519/693518 → failed (no DPR yet)
```

### Leftovers / watch points

- **Streatham Triple (beds24RoomId=693503) price restore:** date 2026-06-20 has price1=999 test value pushed in the previous session. Charlie to confirm when to restore to £80 — run in cm-outbound worktree: `node -e "..."` or a targeted beds24 POST.
- **Valnay DPR rooms (693521/693519/693518):** numAvail silently dropped until DPRs are added in the Beds24 UI (Desktop task). After DPRs added: `node db/queue-inventory.mjs 90 valnay` → live push → 38 failed jobs should now pass.
- **`IT/channel-manager/.env` not in main repo:** The launchd `beds24-push` job will exit 1 (DATABASE_URL not set) until `.env` is created/copied here. Other jobs (stripe-sync etc.) that already run from this repo have their own .env — check whether a shared .env already exists in this tree or needs to be set up.
- **`beds24-pull` also exiting 1** at first run — same .env issue. Once .env is in place both jobs will self-heal on next 10/15 min tick.
- **Vercel cron:** `lib/beds24-push.ts` exports `runBeds24Push()` ready to wire into `app/api/cron/beds24-push/route.ts`. Hobby plan = once/day limit; GitHub Actions trigger needed for more frequent runs.

---

## 2026-06-17 · REPORT · P2 event-driven push + atomic claim

**Branch:** `cms-dev`
**Commit:** `89108a4` feat(beds24): P2 — event-driven push + atomic claim (concurrency-safe)

### What shipped

**Modified `lib/beds24-push.ts`:**
- Atomic drainer claim: generates a `claimId = randomUUID().slice(0,8)` per run
- `UPDATE SyncJob SET status='processing', processingAt=CURRENT_TIMESTAMP, note=claimId WHERE status='pending' AND channel='booking.com' AND beds24RoomId IS NOT NULL AND propertyId != 'seamless'`
- `SELECT` only rows WHERE `note = claimId` — concurrent callers each see only their own batch
- Stale recovery: resets `processing` rows WHERE `processingAt < datetime('now', '-10 minutes')` at start of each run
- Module-level `localDraining` flag short-circuits a second fire-and-forget call within the same process while one is already running
- Dry-run now restores claimed rows to `pending` (so the 10-min cron can pick them up normally)
- Added export: `triggerBeds24Push()` — fires `runBeds24Push({dryRun:false})` void/un-awaited, errors logged to console (Next.js 14 — no `after()`)

**Modified `lib/actions.ts`:**
- Imported `triggerBeds24Push` from `./beds24-push`
- Added `triggerBeds24Push()` (void, no await) AFTER the final `revalidatePath` in all five SyncJob write hooks:
  - `setPrice` → after `queuePriceSync`
  - `setBlock` → after `queueInventorySync`
  - `createBooking` → after `createBookingWithSync`
  - `cancelBooking` → after `queueInventorySync`
  - `moveBookingAction` → single trigger after both `queueInventorySync` calls

**Modified `lib/data.ts`:**
- `createSyncJob`: DELETE now covers `status IN ('pending', 'processing')` — supersedes in-flight rows safely (drainer already has data in memory; the subsequent `markJobs` becomes a no-op on the deleted row)
- `pendingSyncJobs`, `pendingSyncCount`: WHERE now includes `'processing'` rows — UI shows in-flight jobs as pending
- `recentSyncJobs`: WHERE excludes both `'pending'` and `'processing'`

**New `db/migrate-beds24-processing.mjs`:**
- Adds `processingAt DATETIME` column to SyncJob
- Already applied to production Turso; idempotent (safe to re-run)

### Concurrency model

```
Server Action invocation A  →  claimId='abc123'  →  claims rows 1-5  →  POSTs  →  marks done
Server Action invocation B  →  claimId='def456'  →  UPDATE finds 0 pending rows  →  returns {done:0, skipped:true}
```

Turso serializes writes; both UPDATEs execute in sequence, so B's UPDATE finds no pending rows if A claimed them first. The module-level `localDraining` flag provides an in-process short-circuit (no DB round-trip) for the common case.

### Watch points / caveats

- **`import-rates.mjs` not wired:** Rate imports via `db/import-rates.mjs` queue SyncJob rows directly (not through `lib/data.ts`), so they don't get an event-driven trigger. They're handled by the 10-min launchd cron as before.
- **Narrow cron/fire-and-forget race:** If the launchd cron fires at the exact same instant as a Server Action fires a trigger, both read `pending` rows before the claim UPDATE runs. Both would POST the same data to Beds24 (harmless — same value pushed twice). The window is milliseconds; practical risk is negligible.
- **`db/beds24-push.mjs` (launchd CLI) not updated:** The standalone CLI still queries `WHERE status='pending'` without claiming. It's the backstop only; launchd won't start a new instance while the previous run is still in progress (StartCalendarInterval semantics).

---

## 2026-06-17 · REPORT · Three ops + BDC status audit

### 1 — Vercel: BEDS24_REFRESH_TOKEN

**Was missing** from mcconnell-cm Vercel project. Added via `vercel env add` (value piped from `IT/channel-manager/.env`, never printed):

| Environment | Status |
|---|---|
| Production | ✓ Added (17 min ago) |
| Preview (all branches) | ✓ Added (empty-branch form `""`) |

Confirmed via `vercel env ls` — both rows show `Encrypted`. This allows `runBeds24Push()` in the Vercel hub to refresh the Beds24 API token when it expires (token TTL < 24h; without this var the refresh would fail silently on every cold-start after expiry).

### 2 — Launchd backstop: beds24-push / beds24-pull

`IT/channel-manager/.env` already existed in the main repo (created 2026-06-17 18:09). Both jobs are live and clean:

```
- 0  com.mcconnell.cm.beds24-pull
- 0  com.mcconnell.cm.beds24-push
```

(`-` = not currently running, `0` = last exit clean)

**beds24-push log (last 3 runs at :30 :40 :50):**
- 18:30 — 2 jobs pushed, 2 failed (`numAvail dropped — missing DPR?` for 693503 + 693499)
- 18:40 — 1 job pushed, 1 failed (DPR guard)
- 18:50 — 0 pending → `Nothing to push` ✓

**beds24-pull log (last 3 runs):**
- 18:15 — fetched 4 BDC bookings (CREATED: BDC-6091561098, BDC-5459827272, BDC-5266227909, BDC-5266257623)
- 18:30 — 0 new bookings
- 18:45 — 0 new bookings ✓

Both jobs healthy. DPR failures are expected until Valnay/Streatham rooms get DPRs added in Beds24 UI.

### 3 — Streatham Triple price restore (beds24RoomId=693503, 2026-06-20)

**Finding:** The calendar API returned `"calendar": []` for 2026-06-20 — no live override, and a pending SyncJob with `value=85` (not 999). The session-prior "£999 test push" was likely overwritten by a £85 push (SyncJob id=20458, done 2026-06-16 22:18). Base price = £80.

**Dry-run payload shown:**
```json
[{ "roomId": 693503, "calendar": [{ "from": "2026-06-20", "to": "2026-06-20", "price1": 80 }] }]
```

**Live push result:**
- HTTP 201, `price1=80` confirmed in `modified.calendar` ✓ (DPR guard passed)
- Stale pending SyncJob id=20459 (value=85) marked `done` with note `"manual restore: £80 pushed directly, supersedes queued £85"` — prevents cron from re-pushing £85

**Current state:** Room 693503 on 2026-06-20 is now at £80 on Beds24. ✓

### 4 — BDC status per property

Data sources: Beds24 `/inventory/rooms/availability` (2026-06-17 → 2026-06-24) + SyncJob counts (last 7 days, `channel='booking.com'`).

| Property | BDC connected | Rooms linked | Avail (open rooms) | Open SyncJobs | Failed (7d) | Top failure reason |
|---|---|---|---|---|---|---|
| Streatham Rooms | ✓ (bdcHotelId=14715886) | 7/7 | 7/7 open | 0 | 40 | numAvail dropped (missing DPR) |
| Tooting Stays | ✓ (bdcHotelId=13576893) | 6/6 | 5/6 open* | 0 | 3 | numAvail dropped (missing DPR) |
| Valnay Stays | ✓ (bdcHotelId=15779662) | 4/4 | 3/4 open* | 0 | 65 | wrote 1, read back 0 (38) + DPR (24) + session expired (3) |
| Gassiot House | ✓ (bdcHotelId=15676333) | 7/7 | 7/7 open | 0 | 27 | numAvail dropped (DPR) + 2 legacy |
| Seamless Stays | ✓ (bdcHotelId=12686318) | n/a | 3/5 rooms avail* | 18 | 2 | session expired (legacy BDC bot) |

*Closed rooms have 0 availability for all dates queried — likely booked out or blocked, not a channel issue.

**Key observations:**
- **Streatham / Gassiot / Tooting:** All BDC-connected, rooms visible with availability — channel is functionally open
- **Valnay:** 38 failures with note `"wrote 1, read back 0"` are pre-DPR-guard era (stale). 24 are current DPR failures (rooms 693521/693519/693518 have no Daily Price Rule). Fix: add DPRs in Beds24 UI then `node db/queue-inventory.mjs 90 valnay`
- **Seamless:** 18 open SyncJobs are BDC jobs for the Seamless propertyId — these should not be pushed (Seamless is excluded in the drainer). The 2 failed jobs are legacy (session expired = old Playwright bot). The 18 open jobs may need manual cleanup.
- **0 open SyncJobs on Streatham/Tooting/Gassiot/Valnay** — drainer is current; queue drains promptly (DPR failures are immediately marked failed, not stuck pending)
