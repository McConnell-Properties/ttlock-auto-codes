# Beds24 Post-Activation Fix Brief — Booking.com channel update failures

**Context:** All 4 properties (streatham, tooting, gassiot, valnay) are now ACTIVATED on
Booking.com↔Beds24. Prices verified accurate by Charlie. But Beds24 is emailing
**"Booking.com channel update failure"** for every Streatham room, and one room shows
**"Unit not assigned for booking 88364344"**. Charlie's read: *"reservations have not been
imported from our CMS properly — something needs fixing there."* Seamless is held back (not live).

This is a CODE task — DESKTOP has no network and can't see live Beds24. Work on a branch off
`beds24`; record results in `AGENT_HANDOFF.md`.

## Leading hypothesis
The channel-update failures are **downstream of the booking load**, not a price or mapping fault:
Beds24 can't compute/send availability for a room type when a booking in it is **not assigned to
a physical unit**. `db/beds24-load-bookings.mjs` (CC-B) POSTed 41 non-BDC bookings via
`POST /bookings`; if they were created without a unit/sub-room assignment, multi-unit room types
(e.g. Streatham Triple = rooms 1+4, Quad = 10+11, Super King/Twin = 5+6, Double Ensuite = 2+3)
end up with unassigned holds → Booking.com availability push fails across the property.
`Unit not assigned for booking 88364344` is the concrete tell.

## Steps

**1. Get the real error text (don't skip).** The "channel update failure" wrapper is generic.
Open one of the Beds24 error emails (or Beds24 → the property's channel log) and copy the
`= = = = ERROR MESSAGE STARTS = = = =` block. Match it on the Booking.com common-errors list
(https://wiki.beds24.com/index.php/Booking.com:_Synchronise_bookings_prices_availability#Error_messages).
Post the verbatim text to `AGENT_HANDOFF.md`. Confirm or replace the hypothesis below before fixing.

**2. Inspect booking 88364344 and the 41 loaded bookings in Beds24.** `GET /bookings` for them —
check whether each has a `unitId`/sub-unit assignment and sits in the correct room type. Determine
whether `beds24-load-bookings.mjs` set a unit on `POST /bookings` (it likely did not).

**3. Fix the loader + re-assign.** Update `db/beds24-load-bookings.mjs` to assign each booking to a
free physical unit of its room type on `POST /bookings` (confirm the exact Beds24 field —
`unitId`/`subRoom`/auto-assign — via a probe). Re-assign the already-loaded bookings (POST with
the booking `id` + unit). If Beds24 has an auto-assign-units function, that may clear it in bulk.
Idempotent; don't duplicate bookings (match on existing `beds24Id` from the load log).

**4. Verify room↔BDC "Get Codes" mapping against Charlie's authoritative file** —
`roomtypes-bdc-map.csv` in this folder (Property, Room type, physical Room, BDC name, **BDC ID**,
Expedia name). For all 4 live properties, confirm each Beds24 room's mapped Booking.com code matches
the BDC ID here. Cross-check against the `beds24RoomId`/`bdcRoomId` columns CC-A wrote. Notes:
- **Streatham** (all failing): mapping looks correct vs CC-A; failures are expected to be the unit
  issue, not mapping — but verify while you're there.
- **Tooting** is now 6 *distinct* room types (Comfort/Business/Basic/Large/Small/Deluxe), not 5
  identical + 1. The CSV's BDC IDs are sequential 1357689301–07 = internal rtId 15–20, so the
  positional map CC-A used still holds. Confirm Get Codes matches per room and that per-room prices
  flow (they may now differ by room).
- **Seamless restructured** (held back): "Large Double Room" is now a 3-unit type (rooms 2,3,4,
  BDC 1268631801); "Room 1" is BDC 1268631803. The old `ROOMTYPE_MAP_REFERENCE.md` Seamless rows
  are stale — fix when Seamless does its solo go-live, not now.

**5. Confirm fixed.** After the unit fix, push an Update in Beds24 / re-trigger the channel sync;
confirm the failure emails stop and Connection Status is XML Active / Open with no errors. Report.

## Out of scope
- Don't touch Seamless (held back).
- Don't flip CC-D outbound to live (`BEDS24_PUSH_DRYRUN`) until these failures are cleared.
