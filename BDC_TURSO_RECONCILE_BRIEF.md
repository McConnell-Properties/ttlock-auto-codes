# Brief — Additive BDC → Turso reconcile (bring the source of truth current)

**For:** Claude Code on the Mac (it has Turso + Gmail access; the sync agent's sandbox does not).
**Goal:** Add the booking.com reservations made since the 13 Jun 15:27 full export into Turso — **additively, ref by ref** — so Turso (the single source of truth going forward) is current before the direct-booking channel opens. Then re-verify. Do **not** bulk-reload.

## Decision & hard guardrails (do not violate)

- **Turso is authoritative.** Everything is additive. We never overwrite or bulk-reload it.
- **Do NOT run `db/import-reservation-status.mjs`.** It deletes-by-channelRef and reinserts — it would wipe yesterday's manual overbooking moves and recreate the duplicate groups. This path stays frozen for this task.
- **`channelRef` MUST carry the `BDC-` prefix** (e.g. `BDC-5921886935`) to match existing Turso rows. The `book-cli` example omits it — if you insert without the prefix, dedup silently fails and you create duplicates. Always `BDC-<resId>`.
- **Leave the 21 duplicate groups alone.** Charlie clears those in the CRM once visible. Do not "fix" duplicates by reloading.
- **Inventory push is LAST**, and only after the SoT is clean and verified. booking.com already knows its own bookings; the push matters once direct opens. Do not queue/push in this task unless Charlie confirms.
- **Gate every write on Charlie.** Show the computed diff (refs + count) and wait for his go-ahead before running any `book-cli` insert.

## Repo paths

- channel-manager (Turso, book-cli, backup, baseline): `/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager`
- ttlock pipeline (BDC email monitor): `/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes`

## Order of operations

### 1. Snapshot first
```bash
cd "/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager"
npm run db:backup && ls -lt db/backups/cloud-*.sql | head -1
```
Confirm a fresh `cloud-<stamp>.sql` exists and is from *now*. If it didn't write, stop.

### 2. Baseline Turso (the "already there" set)
```bash
npm run db:freshness
node db/_bdc-baseline.mjs   # read-only helper already in the repo; prints every booking.com confirmed ref
```
Record the booking.com confirmed count and the full ref list. Confirm the DB target prints as TURSO (cloud), not a local file.

### 3. Surface the delta (new BDC bookings since 13 Jun)
```bash
cd "/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes"
python3 bdc_email_monitor.py --since 3
```
This scrapes new booking.com emails into the Sheets CRM (deduped via `processed_bookings.json`). Collect the structured fields for each surfaced booking: `ref, property, room, check-in, check-out, unit type, guest, price`.

Note: if the monitor was already run for some of these, it skips them as "already logged" — they're in Sheets but may still be **missing from Turso**. So do not rely on the monitor's output alone; the authoritative gap is the diff in step 4.

### 4. Compute the additive diff
The set to insert = **booking.com refs present in the delta (step 3 / Sheets) but NOT in the step-2 Turso ref list**, compared by `BDC-<resId>`.
Also list any refs **in Turso but not in the delta** — do NOT act on them, just surface them to Charlie (possible cancellations or moves) for his as-you-go checks.
Map each booking to its `roomTypeId` using the table below (match on property + physical room number; fall back to room-type name). **Present the proposed inserts + count to Charlie and wait for confirmation.**

### 5. Insert additively (after Charlie confirms)
For each missing ref:
```bash
cd "/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager"
node db/book-cli.mjs '{"roomTypeId":18,"guestName":"Jane Doe","checkIn":"2026-07-04","checkOut":"2026-07-05","channel":"booking.com","channelRef":"BDC-6812662794","totalPrice":180}'
```
`book-cli` is additive, dedups on ref+dates+room, has no availability gate, and queues pushes only for non-origin channels (expedia, which is off) — so a booking.com insert triggers no extranet push. It prints `{bookingId, syncJobsQueued}` or `{duplicate:true}`. Capture each result.

### 6. Re-verify
```bash
node db/_bdc-baseline.mjs   # booking.com confirmed count should have risen by exactly the number inserted
npm run db:freshness        # Booking.createdAt should be ~now
```
Report: refs added, any that came back `duplicate:true`, the before/after booking.com counts, and the in-Turso-not-in-delta list. Stop there — do not touch inventory.

## RoomType → id map (property | id | units | bdcRoomId | physical rooms | name)

```
streatham | 1 | 2 | 1471588610 | 1,4   | Triple Room with Private Bathroom
streatham | 2 | 2 | 1471588605 | 10,11 | Quad room, with Shared Bathroom
streatham | 3 | 2 | 1471588612 | 5,6   | Superior King or Twin Room
streatham | 4 | 1 | 1471588611 | 8     | Double or Twin Room with Private Bathroom
streatham | 5 | 2 | 1471588601 | 2,3   | Double room-Ensuite
streatham | 6 | 1 | 1471588604 | 9     | Twin Room, with full private kitchen and ensuite
streatham | 7 | 1 | 1471588609 | 7     | Basic Single Room with Shared Bathroom
gassiot   | 8 | 1 | 1567633306 | 1     | Superior King or Twin Room
gassiot   | 9 | 1 | 1567633303 | 7     | Double Room, Shared Bathroom
gassiot   |10 | 1 | 1567633305 | 3     | Twin or Super King Bed in Cozy Room (Shared Bath)
gassiot   |11 | 1 | 1567633308 | 6     | Budget Double Room with Shared Bathroom
gassiot   |12 | 1 | 1567633307 | 5     | Basic Double Room with Shared Bathroom
gassiot   |13 | 1 | 1567633302 | 4     | Single Room, Shared bathroom
gassiot   |14 | 1 | 1567633301 | 2     | Two Twin Beds or Super King, Vented, Shared bathroom
tooting   |15 | 1 | 1357689301 | 1     | Room 1
tooting   |16 | 1 | 1357689302 | 2     | Room 2
tooting   |17 | 1 | 1357689304 | 3     | Room 3
tooting   |18 | 1 | 1357689305 | 4     | Room 4
tooting   |19 | 1 | 1357689306 | 5     | Room 5
tooting   |20 | 1 | 1357689307 | 6     | Room 6
valnay    |21 | 1 | 1577966206 | 4     | Twin Room/ Super King Bed, with Shared Bathroom
valnay    |22 | 1 | 1577966204 | 5     | Twin Room/ Super King Bed, with En-suite
valnay    |23 | 3 | 1577966205 | 1,3,6 | Business, Double Room, Shared Bathroom
valnay    |24 | 1 | 1577966203 | 2     | Double Room, Shared Bathroom
seamless  |25 | 1 | 1268631801 | 1     | Room 1
seamless  |26 | 1 | 1268631803 | 3     | Large Double Room
seamless  |27 | 1 | 1268631804 | 5     | Single Room with Shared Bathroom
seamless  |28 | 1 | 1268631802 | 2     | Double Room with Shared Bathroom
seamless  |29 | 1 | 1268631805 | 4     | Deluxe Double Room
```
(Verify against the live DB before trusting; this map was read from the local dev.db copy: `SELECT id, propertyId, name, totalUnits, bdcRoomId, physicalRooms FROM RoomType`.)

## Out of scope for this run (next task)

Wire the BDC-email path to write to Turso automatically (via `book-cli`'s logic or a shared function) so new bookings reach the SoT without the manual diff — currently the monitor only writes to Sheets, so the SoT drifts behind. Land this before opening direct booking. Do not build it in this task.
