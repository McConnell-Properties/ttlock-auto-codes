# Beds24 Go-Live Plan — Booking.com

> Operational / manual companion to `BEDS24_MIGRATION_BRIEF.md`. This file = the
> channel-connection steps done in the Beds24 + Booking.com UI. The brief = the API
> automation that loads the data and runs the ongoing sync. See the **Master sequence**
> in the brief for how the two interleave.

**Goal:** Connect Booking.com to Beds24 (two-way) so reservations import and availability stays in sync — without your guest-facing prices changing.

**The one rule that drives everything:** When you activate the connection, Booking.com *deletes* its own prices and availability and replaces them with whatever is in Beds24. So everything below has to be correct in Beds24 *before* you flip the switch. Get the order wrong and you risk wrong prices or double bookings.

---

## Priority 1 — Rooms mapped correctly (blocks everything)

Before pricing or availability means anything, your Beds24 rooms must match Booking.com.

- Confirm all 4 properties and 20 room types exist in Beds24.
- Each Beds24 room type must correspond to a Booking.com room type (you map these with "Get Codes" during connection).
- If you sell a room individually elsewhere but as a multi-quantity "room type" on Booking.com, set up virtual rooms.

*Why first: prices and bookings attach to rooms. If mapping is wrong, correct prices land on the wrong room.*

---

## Priority 2 — Pricing (so prices stay the same)

This is the half that keeps your rates identical at go-live.

1. Create **one Daily Price Rule per room** (PRICES > DAILY PRICE RULES), with **Booking.com ticked** under "Enable." `price1` = your standard rate.
2. Load your current rates into Beds24 — via the calendar (date-range entry), a CSV/API load, or your pricing tool feeding in.
3. Verify with **"Price Check"** (and **"Price Data"** during connection) that what Beds24 will send matches your live Booking.com prices.

**Watch-outs:**
- You can't pull existing prices *out* of Booking.com — you supply them from your own data/tool.
- Linked/derived rates won't sync — deactivate those on Booking.com, use standalone rules in Beds24.
- After go-live you can no longer edit prices in the Booking.com extranet. Beds24 becomes the source of truth.
- Extras, taxes and fees do **not** auto-sync — keep managing those in the extranet.

---

## Priority 3 — Availability / current reservations (so no overbookings)

This is what makes the calendar truthful before you go live.

1. **Import upcoming Booking.com bookings** (connection Step 7, "Import Existing Bookings" — 10 at a time, repeat as needed).
2. Add bookings from **every other source** (direct, any Expedia, phone) so Beds24 reflects true availability — via Add Booking, or CSV import.
3. Use **Override** in the calendar to close any dates that shouldn't be bookable.

*Why this must happen before activation: if Beds24 doesn't know a date is taken, it will send that date as available and Booking.com can resell it.*

---

## Priority 4 — Connect & activate (go-live day)

Do this once Priorities 1–3 are done and verified.

1. In Booking.com: Account > Connectivity Provider > select **Beds24**. Tick **both** "Reservations" and "Rates and Availability" (two-way).
2. Enter your Booking.com Hotel ID in Beds24.
3. Map rooms ("Get Codes"), then map rate plans ("Get Codes").
4. Enable each room. Set a multiplier only if you need a markup/conversion.
5. Click **"Price Data"** — final check that prices and availability are correct.
6. **Activate Connection** → "Activate Connection Now."
7. Re-import bookings, then push an Update.
8. In Booking.com, turn **OFF Auto-Replenishment** (Rates & Availability > Calendar settings) so cancellations don't auto-reopen rooms you've filled elsewhere.
9. Refresh connection status — confirm **XML Active** and **Open / Bookable**, no errors.

---

## Pre-flight checklist (don't activate until all true)

- [ ] 4 properties + 20 room types set up and mapped to Booking.com
- [ ] A Daily Price Rule per room, Booking.com enabled
- [ ] Current rates loaded and verified via Price Check
- [ ] All upcoming Booking.com bookings imported
- [ ] All non-Booking.com bookings entered / dates blocked
- [ ] Rate plans mapped
- [ ] Price Data reviewed and matches live prices
- [ ] Auto-Replenishment turned off after activation

---

## Not needed to go live (do after)

- **Expedia** — add once Booking.com is stable (+~€11/mo for 20 links). Same model: it pulls prices/availability from Beds24.
- **Direct booking widget + Stripe** — highest-value next step (avoids OTA commission), but not required to go live.
- **Automations** — review pulling, guest messaging, dashboards via the API.

---

## Reality check

- Booking.com lock-in is real: extranet pricing is disabled after activation.
- Same-day cutoff/advance hours can only be changed by Booking.com support after activation — set it before if it matters.
- OTA commission (~15%) still applies on Booking.com bookings regardless. Only direct bookings avoid it.

---

## ⚠️ Reconciliation notes (added by DESKTOP — read alongside the brief)

1. **Property/room count mismatch.** This plan says *4 properties / 20 room types*, but the
   hub's room map (`ROOMTYPE_MAP_REFERENCE.md`) has **5 real properties** —
   streatham, tooting, gassiot, valnay, **seamless** — and ~29 real room types. Resolve before
   Priority 1: is **Seamless** (BDC hotel `12686318`, 5 room types) being onboarded to Beds24
   now or later? If it's omitted here, its bookings/availability won't sync and it stays on the
   old path. Confirm with Charlie.
2. **The API can do Priorities 2 & 3 for you.** "Load current rates" and "add bookings from
   every other source" are framed as manual, but the hub already holds 8,497 rate overrides and
   476 bookings. Once rooms exist in Beds24 (Priority 1) and we have write scope, the API
   bulk-loads them — see the brief's "Initial load" step. Manual entry is the fallback.
3. **Expedia stays on the current path** until it's linked to Beds24. The outbound cutover in
   the brief is therefore **Booking.com-only**: the Beds24 push consumes BDC-channel `SyncJob`
   rows; Expedia rows keep going through the existing browser task. Don't disable Expedia
   pushing when Booking.com moves to Beds24.
