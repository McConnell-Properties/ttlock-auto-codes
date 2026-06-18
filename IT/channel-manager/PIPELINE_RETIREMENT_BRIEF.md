# Build brief — Retire `run_reservation_pipeline.py` → CMS-native reservation services (Turso)

**Context:** CMS-only, Little Hotelier retired, **Turso is the source of truth.** The pipeline (`scripts/run_reservation_pipeline.py` in the pipeline repo) does 4 jobs off the legacy CSV: (1) ingest → `reservation_status.csv`, (2) **TTLock codes**, (3) **£80 deposit hold**, (4) write **`checkin_data.json`**. We move 2/3/4 onto Turso and drop 1.

**Repos:** `channel-manager` (CMS / Turso) and the pipeline repo `…/IT/ttlock-auto-codes` (holds the TTLock client `multi_property_lock_codes.py` + creds). Reservations now arrive via the BDC email scraper → `book-cli` (with auto-assign), not the CSV.

## Prerequisites (must land first)
- **`ROOM_AUTOASSIGN_BRIEF`** — room codes need an assigned physical room (`ROOM_LOCK_IDS[room]`). No room → no room code.
- **Deposit creation in the CMS** (`DEPOSIT_PREAUTH_BRIEF`, now updated to CMS-creates) — needed so `checkin_data.json` has a deposit link to publish.

## ⚠️ Safety
- TTLock here is **WRITE** (creates/deletes physical door codes). Test on a single test booking/lock first; **never mass-delete live codes**. Make create idempotent (skip if already issued).
- Production Turso: schema changes **additive only**. Stripe in **TEST MODE** for deposit-creation dev.
- **Don't retire anything until the Turso path is verified at parity for a full cycle** (Phase 4).

---

## Phase 1 — TTLock codes on Turso (replaces pipeline Job 2)
Recommend a **Python** job that **reuses `multi_property_lock_codes.py`** (proven client + creds) and reads/writes **Turso** via the libsql Python client — don't re-implement the TTLock client in Node.
- Source: confirmed Turso `Booking`s with `checkOut >= today`. Need `channelRef, propertyId, physicalRoom, checkIn, checkOut, status`.
- Map `propertyId` → `tt.PROPERTIES` full name (e.g. `streatham`→"Streatham Rooms"); `physicalRoom` → `ROOM_LOCK_IDS` key.
- `code` = last 4 digits of `channelRef`. Window: check-in **15:00** UK → checkout **11:00** UK (ms).
- **Create** the front-door code (always) + the room code (if a room is assigned). Idempotent — skip if already issued.
- **Delete** codes for bookings that are checked-out (`checkOut < today`) or `cancelled` (reuse `_delete_expired_codes` logic).
- **Store lock state in Turso** (additive migration — Booking columns or a small `LockCode` table): `frontDoorPwdId`, `roomPwdId`, `codedRoom`, `frontDoorLockSet`, `roomLockSet`, `lockStart`, `lockEnd` — mirror the pipeline's tracking fields so create/delete are idempotent.
- If a booking has no assigned room (overbooking/unassigned): issue the front-door code, leave the room code pending + flag.

## Phase 2 — Publish `checkin_data.json` from Turso (replaces pipeline Job 4)
Write the **same JSON shape the website already consumes**, sourced from Turso, keyed by `channelRef`, active bookings only (`checkOut >= today`):
```json
{ "guestName","checkIn","checkOut","arrivalTime","roomNumber","lockCode","stripeLink","stripeStatus" }
```
- `arrivalTime` = `CrmRecord.arrivalTime` else `15:00`; `roomNumber` = `physicalRoom`; `lockCode` = last 4 of ref; `stripeLink`/`stripeStatus` = the CMS deposit link/status.
- Keep the rule: **clear `stripeLink` when the deposit is secured** (held/captured/paid).
- This keeps both the **website** (door code + deposit link via `lib/portal.ts`) and the **CMS arrival job** (`poll-ttlock-arrivals` reads `lockCode`) working unchanged.
- *Future (note only):* move these fields into Turso and have the website read them via the CMS API, retiring `checkin_data.json` entirely.

## Phase 3 — Deposit creation on CMS (see `DEPOSIT_PREAUTH_BRIEF`)
Port the pipeline's Stripe block: CMS generates the manual-capture Checkout link per the timing rules (short ≤5n: 2 days before check-in; long >5n: 3 days before check-out), surfaces it as the deposit link in `checkin_data.json` (Phase 2), webhook → `held`, auto-release 2 days post-checkout. Keep the reconcile-from-pipeline path only for legacy holds during transition.

## Phase 4 — Retire legacy (only after parity verified)
- Disable the `com.mcconnell.pipeline-watch` launchd job and the `reservation-import` job (LH CSV — won't regenerate).
- In `poll-booking-emails.mjs`, neutralise the "trigger Little Hotelier export" branch.
- Stop `run_reservation_pipeline.py` running. Keep the 13-Jun `reservation_status.csv` as a historical seed only.

## Cutover order
auto-assign → TTLock-on-Turso (create/delete + state) → deposit creation in CMS → publish `checkin_data.json` from Turso → **verify parity one full cycle** → retire legacy.

## Tests (report PASS/FAIL)
1. A test booking in Turso (future dates, assigned room) → front-door + room codes created with the right window; state stored; re-run is idempotent (no duplicate codes).
2. Mark that booking checked-out / cancelled → its codes are deleted; state updated.
3. `checkin_data.json` generated from Turso matches the expected shape; door code + room correct; `stripeLink` cleared when secured.
4. Deposit link generated by the CMS for a booking hitting the timing rule (test mode).
5. Legacy `pipeline-watch` / `reservation-import` confirmed dormant; no path still writes `reservation_status.csv`.
6. No live door code deleted unintentionally during testing.
