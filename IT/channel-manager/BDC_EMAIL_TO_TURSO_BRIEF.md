# Build brief — BDC email → Turso reservation (LIVE)

**Flow (Charlie's spec):** a new Booking.com email is scraped → the **CMS creates the reservation in Turso (the single source of truth) at that moment** → auto-assigns a room → issues the TTLock code → creates the deposit link → the website reads it all from Turso to present the deposit link. This replaces "scraper writes to Google Sheets only."

**Repos:** pipeline repo (`bdc_email_monitor.py` — the scraper) + `channel-manager` (Turso, `book-cli`, deposit, TTLock).

**Today's gap:** `bdc_email_monitor.py` writes to Google Sheets + `processed_bookings.json` only — it never reaches Turso. Wire it to Turso.

## Build
1. On each newly-scraped booking (after the `processed_bookings.json` dedup), **create it in Turso** — reuse `db/book-cli.mjs` (additive; dedups on ref+dates+roomType). Map room **type** → `roomTypeId` via `bdcRoomId`/name+qualifier (`ROOMTYPE_MAP_REFERENCE.md`), then **auto-assign** a physical room (`ROOM_AUTOASSIGN_BRIEF.md`). `channelRef = BDC-<resId>`.
   - Mechanism: simplest is the Python scraper shelling out to `node db/book-cli.mjs '<json>'`; or POST to a CMS endpoint with the Bearer key. Pick whichever runs cleanly from the scraper's context.
2. Sheets writes can stay during transition, but **Turso is the SoT** — the website reads from Turso/CMS, not Sheets.
3. Once the booking is in Turso, the **TTLock job** (`PIPELINE_RETIREMENT_BRIEF` Phase 1) issues the door code, the **deposit job** (`DEPOSIT_PREAUTH_BRIEF`) creates the £80 hold link, and **`checkin_data.json`** (Phase 2) publishes door code + deposit link for the website. Run these inline after insert, or let the scheduled jobs pick it up.
4. **One of everything per booking.** Guard on `channelRef` so a stay never gets two reservations, two deposit holds, or two door codes — especially given the existing duplicate-`channelRef` rows (see `GO_LIVE_PLAN.md`).

## LIVE
Real Stripe (live key), real Turso, real TTLock. **Smoke-test ONE real upcoming booking end-to-end** (reservation in Turso → room assigned → code issued → deposit link visible on the site) before running the 30-day backlog.

## Tests (report PASS/FAIL)
1. One scraped booking → exactly one Turso `Booking` (correct roomTypeId + assigned room), one door code, one deposit link; website shows the deposit link sourced from Turso.
2. Re-scrape the same ref → no duplicate booking/hold/code.
3. A ref that's already a duplicate in Turso → guarded (no second hold/code); flagged.
4. Backlog run lands each new ref once.
