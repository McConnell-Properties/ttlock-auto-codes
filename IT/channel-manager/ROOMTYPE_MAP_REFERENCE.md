# RoomType mapping reference (for the BDC → Turso reconcile)

Authoritative map pulled from `db/dev.db`. **Caveat: these are local ids — confirm they match cloud Turso before inserting** (run a `SELECT id, propertyId, name, bdcRoomId FROM RoomType` against Turso and diff; cloud is the source of truth). They *should* match (same seed) but verify.

## Important nuance — BDC emails give a room TYPE; the CMS now auto-assigns the physical room
**Little Hotelier is retired — the CMS owns allocation.** New bookings scraped from BDC emails carry the **room type** (and a "Business"/qualifier), **not** a physical room. There is no longer an LH/CSV step to backfill the room. So for these additive inserts:
- Map to `roomTypeId` by **`bdcRoomId`** (most reliable, if the scrape captured it) or by the **full room-type name including the qualifier**.
- Then **auto-assign a free physical room** of that type for the stay dates — see `ROOM_AUTOASSIGN_BRIEF.md`. If none is free (overbooking), leave `physicalRoom` null + flag for manual allocation; still create the booking.
- Availability is computed at the room-type level, so the hold counts correctly even before/without a physical room.

## ⚠️ The name-matching trap (real example)
The sample `BDC-5711359840` scraped as **"Double Room with Shared Bathroom (Valnay, Business)"**. Naive name-matching → `id 24` ("Double Room, Shared Bathroom"). **That's wrong** — the "Business" qualifier means it's `id 23` ("Business, Double Room, Shared Bathroom"). Always honour the qualifier (or use `bdcRoomId`), or you'll mis-map every Valnay Business booking.

## bdcRoomId → roomTypeId (preferred key)
| property | bdcRoomId | roomTypeId | name |
|---|---|---|---|
| gassiot | 1567633301 | 14 | Two Twin/Super King, Vented, Shared |
| gassiot | 1567633302 | 13 | Single Room, Shared bathroom |
| gassiot | 1567633303 | 9 | Double Room, Shared Bathroom |
| gassiot | 1567633305 | 10 | Twin or Super King in Cozy Room (Shared) |
| gassiot | 1567633306 | 8 | Superior King or Twin Room |
| gassiot | 1567633307 | 12 | Basic Double Room with Shared Bathroom |
| gassiot | 1567633308 | 11 | Budget Double Room with Shared Bathroom |
| seamless | 1268631801 | 25 | Room 1 |
| seamless | 1268631802 | 28 | Double Room with Shared Bathroom |
| seamless | 1268631803 | 26 | Large Double Room |
| seamless | 1268631804 | 27 | Single Room with Shared Bathroom |
| seamless | 1268631805 | 29 | Deluxe Double Room |
| streatham | 1471588601 | 5 | Double room-Ensuite |
| streatham | 1471588604 | 6 | Twin Room, full private kitchen + ensuite |
| streatham | 1471588605 | 2 | Quad room, Shared Bathroom |
| streatham | 1471588609 | 7 | Basic Single Room with Shared Bathroom |
| streatham | 1471588610 | 1 | Triple Room with Private Bathroom |
| streatham | 1471588611 | 4 | Double or Twin Room with Private Bathroom |
| streatham | 1471588612 | 3 | Superior King or Twin Room |
| tooting | 1357689301 | 15 | Room 1 |
| tooting | 1357689302 | 16 | Room 2 |
| tooting | 1357689304 | 17 | Room 3 |
| tooting | 1357689305 | 18 | Room 4 |
| tooting | 1357689306 | 19 | Room 5 |
| tooting | 1357689307 | 20 | Room 6 |
| valnay | 1577966203 | 24 | Double Room, Shared Bathroom |
| valnay | 1577966204 | 22 | Twin Room/Super King, En-suite |
| valnay | 1577966205 | 23 | **Business**, Double Room, Shared Bathroom |
| valnay | 1577966206 | 21 | Twin Room/Super King, Shared Bathroom |

## physical room # → roomTypeId (for the CSV / allocated path + verification)
- **flat:** 1→30
- **gassiot:** 1→8, 2→14, 3→10, 4→13, 5→12, 6→11, 7→9
- **seamless:** 1→25, 2→28, 3→26, 4→29, 5→27
- **streatham:** 1→1, 4→1, 2→5, 3→5, 5→3, 6→3, 7→7, 8→4, 9→6, 10→2, 11→2
- **tooting:** 1→15, 2→16, 3→17, 4→18, 5→19, 6→20
- **valnay:** 1→23, 3→23, 6→23, 2→24, 4→21, 5→22

Multi-room types (units>1): streatham 1(rooms 1,4), 2(10,11), 3(5,6), 5(2,3); valnay 23(rooms 1,3,6). Availability is computed at the roomType level, so a type-only insert with null physicalRoom still decrements correctly.
