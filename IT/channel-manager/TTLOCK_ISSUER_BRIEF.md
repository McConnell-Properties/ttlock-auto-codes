# Build brief — TTLock door-code issuer on Turso (URGENT)

**Why now:** new reservations flow **Beds24 → Turso**, but **nothing issues their door codes.** The legacy pipeline's trigger (Little Hotelier → `automation-data/inputs/`) is dead, and the scraper that briefly issued codes inline is retired. So guests on new bookings have no way in. This builds the Turso-native issuer. (It's Phase 1 of `PIPELINE_RETIREMENT_BRIEF`, pulled out to build immediately.)

**Repos:** reads **Turso** (the channel-manager DB) and **reuses the pipeline repo's `scripts/multi_property_lock_codes.py`** (proven TTLock client + creds + `ttlock_token.json`). **Build it in Python** — do NOT re-port the lock client to Node; it opens real doors and the Python client is battle-tested. (The CC has access to both repos.)

## ⚠️ Safety
- TTLock here is a **WRITE path — it creates and deletes real door codes.** Add a **`--dry-run`** that prints intended actions and writes nothing; run it first. **Test on ONE test booking before a full sweep; never mass-delete live codes.** Create must be **idempotent** (skip if already issued).
- Production Turso: schema changes **additive only**. Don't touch the `SyncJob` queue, `lib/allocate.ts`, or Beds24 files.
- **Standalone launchd job — NOT `automation/install.sh`** (that's Beds24's).

## 1. Schema — `LockCode` table (additive, idempotent, cloud Turso)
Keep lock state **out of `Booking`'s hot allocation columns** — use a side table:
`LockCode(bookingId INTEGER, channelRef TEXT, frontDoorPwdId TEXT, roomPwdId TEXT, codedRoom TEXT, frontDoorSet TEXT DEFAULT '', roomSet TEXT DEFAULT '', lockStart TEXT, lockEnd TEXT, updatedAt DATETIME)`.
(Mirrors the pipeline's `reservation_status.csv` lock-tracking fields so create/delete are idempotent.)

## 2. The issuer — `scripts/issue-ttlock-codes.py` (reads Turso, reuses `multi_property_lock_codes` as `tt`)
- Select **confirmed** Turso bookings with `checkOut >= today`: need `channelRef, propertyId, physicalRoom, checkIn, checkOut, status`.
- Map `propertyId` → `tt.PROPERTIES` full name (e.g. `streatham` → "Streatham Rooms"); `physicalRoom` → `ROOM_LOCK_IDS` key.
- `code` = last 4 digits of `channelRef`. Window: check-in **15:00** UK → checkout **11:00** UK (epoch ms).
- **Create** the front-door code (always) + the room code (if a room is assigned). Idempotent — skip if `LockCode` already holds the pwdId. Store pwdIds + window in `LockCode`.
- **Delete** codes for bookings that are checked-out (`checkOut < today`) or `cancelled` (reuse the pipeline's `_delete_expired_codes` logic + the stored pwdIds).
- **No room assigned** (overbooking/unassigned) → issue the front-door code, leave the room code **pending + flagged**, don't fail.
- **Seamless / Flat** have no lock map → skip cleanly.

## 3. Publish `checkin_data.json` (replaces the pipeline's old write)
Same shape the **website** (`lib/portal.ts`) and the **arrival poller** (`poll-ttlock-arrivals.mjs`) already consume, keyed by `channelRef`, active bookings only:
`{ guestName, checkIn, checkOut, arrivalTime, roomNumber, lockCode, stripeLink, stripeStatus }`.
Source from Turso: `arrivalTime` from `CrmRecord`; `roomNumber` from `physicalRoom`; `lockCode` = last 4 of ref; `stripeLink`/`stripeStatus` from the deposit fields. **Keep clearing `stripeLink` when the deposit is secured.**

## 4. Trigger — standalone launchd, periodic sweep (~every 15–30 min)
Idempotent, so a recurring sweep is safe and covers both new bookings and checkouts/cancellations. Log to `logs/`. Add the plist by hand (`launchctl bootstrap`), **not** via `install.sh`.

## 5. Tests (report PASS/FAIL — `--dry-run` first)
1. Test booking (future, assigned room) → front + room codes created, window correct, `LockCode` stored; re-run is idempotent (no duplicate codes).
2. Checked-out / cancelled test booking → its codes deleted, `LockCode` updated.
3. No room assigned → front-door issued, room code flagged pending, no error.
4. `checkin_data.json` regenerated with the right code/room/deposit-link; `stripeLink` cleared when secured.
5. Seamless/Flat skipped; no live code deleted unintentionally.

## Dependency (also flagged in `AGENT_HANDOFF.md`)
**Room** codes need a correct **assigned physical room** → gated on the allocation fix (the `excludeBookingId` self-conflict bug CC-B owns). **Front-door** codes issue regardless, so guests aren't fully locked out while allocation is sorted.
