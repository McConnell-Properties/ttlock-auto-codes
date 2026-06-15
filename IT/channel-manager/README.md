# McConnell Enterprises — Channel Manager

Single source of truth for bookings, rates and availability across Booking.com, Expedia and (soon) direct bookings. No OTA APIs needed — changes are queued as **sync jobs** and pushed to the extranets via Claude in Chrome using the proven `setRoomInventory()` console recipe.

## What's included (Phase 1: backend admin)

- **Dashboard** — today's arrivals/departures, occupancy, pending sync count
- **Calendar** — 14-day availability & rate grid per property; click any cell to change price or block rooms
- **Bookings** — list, create (any channel), cancel
- **Sync queue** — every change that needs pushing to BDC/Expedia, grouped by channel & property, with ready-made Booking.com console commands
- **Properties** — channel ID mappings; fill in the TBD BDC room IDs here as you scrape them

All 5 properties are pre-seeded from `IT/room-type-mapping.md` (27 room types). Streatham is fully mapped; Gassiot/Tooting/Valnay/Seamless BDC room IDs are TBD.

## Run it on your Mac

1. **Install Node.js** (once): download the LTS installer from https://nodejs.org, or `brew install node`
2. In Terminal (one line):

```bash
cd "/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager" && npm install && npm run dev
```

3. Open http://localhost:3000

The database ships pre-built at `db/dev.db` (seeded + a year of pricing already imported) — back it up by copying it. If you ever need to rebuild from scratch: `npm run db:setup && node db/import-rates.mjs`.

## Pricing imports

A year of nightly rates (Jun 2026 – May 2027) is imported from the CSVs in `db/pricing/` (Fountain = Tooting). Prices are final (multiplier row is informational). To re-import after updating the CSVs:

```bash
node db/import-rates.mjs              # imports + queues price push jobs
node db/import-rates.mjs --no-sync    # imports only (already live on OTAs)
```

The sync queue collapses per-date price jobs into contiguous same-price date ranges (matching BDC's bulk-edit calendar), with per-range and per-property bulk "done" buttons.

## How the sync flow works

1. You change a price / block a room / add or cancel a booking in the admin.
2. The app computes the new rooms-to-sell and queues **sync jobs** for the channels that need updating (a booking's origin channel is skipped — it already knows).
3. Open **Sync queue**: run the jobs via Claude in Chrome on the BDC/Expedia extranets (the BDC console recipe is generated for you), then mark each job done.

Room types without a BDC room ID don't get Booking.com jobs yet — add IDs on the **Properties** page.

## Roadmap (next phases)

- **Phase 2 — Direct booking website**: public site reading availability from this DB, Stripe card payments, books straight into the same system.
- **Phase 3 — Chrome agent automation**: package the sync queue as a Claude in Chrome skill that reads pending jobs and executes them on both extranets; Gmail polling to auto-import OTA reservation/cancellation emails.
- **Phase 4 — Hosting**: deploy to Vercel + Supabase (or Turso, which is a drop-in for the current SQLite setup — just change `DATABASE_URL`). The data layer is one file (`lib/data.ts`, plain SQL) so the swap is contained.

## Tech notes

- Next.js 14 (App Router) + TypeScript, no UI framework
- SQLite via `@libsql/client` (pure JS, no native build steps); all SQL lives in `lib/data.ts`
- Availability is **computed**, never stored: `rooms to sell = total units − confirmed bookings − manual blocks` per date
- Dates are `YYYY-MM-DD` strings throughout; check-out date is exclusive
