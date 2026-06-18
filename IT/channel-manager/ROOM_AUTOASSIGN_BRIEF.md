# Build brief — Auto-assign a physical room at booking ingest (CMS-only; Little Hotelier retired)

**Architecture change:** McConnell is now **CMS-only — Little Hotelier is retired.** Previously LH assigned the physical room and it backfilled into Turso via `reservation_status.csv`. **That path no longer exists.** So the CMS must assign a physical room itself whenever a booking is ingested — BDC email imports now, direct bookings soon.

**Repo:** `channel-manager`. Production **Turso** is the source of truth. All changes additive/safe.

**Problem:** `db/book-cli.mjs` inserts `physicalRoom = NULL`, and `createBookingWithSync` (`/api/bookings`) doesn't assign either. With LH gone, nothing fills the room → bookings land with no physical room.

## 1. Allocation helper — `lib/allocate.ts`
`assignRoom(roomTypeId, checkIn, checkOut, { excludeBookingId? }) → physicalRoom | null`
- Read the type's physical rooms from `RoomType.physicalRooms` (comma list — e.g. `"2,3"`, `"1,4"`, or single `"5"`).
- A room is **free** if no `confirmed` Booking on the same property with that `physicalRoom` **overlaps** `[checkIn, checkOut)` (overlap = `existing.checkIn < new.checkOut AND existing.checkOut > new.checkIn`) and no `Block` covers it.
- Return the **first free** room (stable ascending order). If none free → return `null` (overbooking).
- Read-only, parameterised. Reuse the existing overlap SQL pattern from `book-cli.mjs`/availability.

## 2. Wire into ingest
- **`book-cli.mjs`** (BDC email imports): after resolving `roomTypeId`, call `assignRoom` and insert the result as `physicalRoom`. **Keep the no-availability-gate behaviour** — if `assignRoom` returns `null` (overbooked), still create the booking with `physicalRoom = NULL` and note `UNASSIGNED — no free room (overbooking), needs manual allocation`. (BDC already accepted it; we mirror it and flag it for Charlie to move, as he's been doing.)
- **`createBookingWithSync`** (`lib/data.ts`, used by `/api/bookings` + admin): same auto-assign. For **direct** bookings availability is gated upstream, so a free room should normally exist.
- Sequential safety: because `assignRoom` queries confirmed bookings' `physicalRoom`, back-to-back inserts won't double-book the same room.

## 3. Backfill existing unassigned bookings — `db/backfill-room-assignments.mjs`
- For `confirmed` bookings with `physicalRoom IS NULL` (the email-imported ones + legacy `Imported` rows), run `assignRoom` oldest-check-in-first and set the room. Where none free, leave `NULL` + flag.
- **`--dry-run`** that prints proposed assignments; **stop for review** before writing.
- **Never move a booking that already has a room** — manual allocations (Charlie's overbooking moves) are sacred.

## 4. Room sets (from the verified map — see `ROOMTYPE_MAP_REFERENCE.md`)
Multi-room types `assignRoom` chooses among: streatham id 1 → {1,4}, id 2 → {10,11}, id 3 → {5,6}, id 5 → {2,3}; valnay id 23 → {1,3,6}. All others are single-room.

## Safety
- Production DB; helper is read-only; writes only **set `physicalRoom` on rows where it's NULL**. Don't reassign already-assigned rooms.
- The **21 duplicate `channelRef` groups** can make a room look occupied by a phantom copy → `assignRoom` may fail to place a real booking. If that happens, flag it rather than forcing — Charlie is cleaning the dupes in the CRM.
- Stripe / inventory-sync untouched.

## Tests (report PASS/FAIL)
1. `assignRoom` → free room for a vacant type/date; returns the OTHER room of a 2-room type when one is taken; returns `null` when all are taken.
2. `book-cli` auto-assign: new booking gets a room; an overbooking gets `null` + flag and is still created.
3. Backfill `--dry-run` lists proposals; applying sets `physicalRoom` only on NULL rows; re-run is idempotent; no already-assigned booking moved.
4. Two new bookings of the same 2-room type/dates get different rooms (no self-collision).

## Note — dead paths to retire (flag, separate cleanup)
With LH gone, these no longer feed the system and shouldn't be relied on for room data:
- `reservation-import` job → `import-reservation-status.mjs` (read `reservation_status.csv`, an LH-derived file that won't regenerate). The 13-Jun CSV stays only as the historical seed.
- The "trigger Little Hotelier export" branch in `poll-booking-emails.mjs` — there's no LH export to trigger now; new BDC bookings come via the email scraper → `book-cli` → Turso (with auto-assign).
