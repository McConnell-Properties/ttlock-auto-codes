# Streatham Rooms — Direct Booking Website

Public booking site for Streatham. The **channel manager is the source of truth**:
availability is always fetched live from its API and bookings are created via
`POST /api/bookings`, which puts them straight into the reservation status and
queues Booking.com/Expedia inventory updates automatically.

## Run it on your Mac

Two terminals:

```bash
# 1. channel manager (must be on port 3000)
cd "/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager" && npm run dev

# 2. booking site (port 4100)
cd "/Users/charliemcconnell/ttlock-auto-codes/IT/booking-site" && npm install && npm run import-photos && npm run dev
```

Open http://localhost:4100

**Port note:** Next.js auto-increments ports when one is busy, so the channel
manager may land on 3001/3002 if something else holds 3000 — check its
terminal output and set `CHANNEL_MANAGER_URL` in `.env` to match. The booking
site itself is pinned to 4100 to stay clear of that chain.

## What guests get

- **Search** by dates, number of guests, separate-beds need, and a room
  preference (private bathroom / private kitchen / none).
- **Live availability** with photos, amenities, and transparent pricing:
  the long-stay discount (same tiers as `special quote/data/discounts.csv` —
  20%/26%/32%/35%) is applied and shown with the saving.
- **Room-switch fallback**: if no single room covers the whole stay, the site
  runs `python3 quote.py` to offer Pareto-optimal switching plans (fewest
  switches / cheapest / most preferred-nights). The reservation data fed to
  quote.py is the **latest reservation_status export** (TTLock pipeline,
  `RESERVATION_STATUS_PATH`) merged with channel-manager bookings the file
  doesn't know about yet (direct site bookings, manual entries), deduped by
  booking reference — the file always wins. Booking a plan creates one linked
  reservation per segment, with the physical room in the notes for allocation.
- **Stripe Checkout** payment, then the booking is created on the verified
  success page (idempotent per payment reference, stored in `.data/`).

## Test mode vs live payments

- `STRIPE_SECRET_KEY` empty in `.env` → **TEST MODE**: a clearly-labelled
  banner is shown and bookings are created without payment (channelRef
  `test_…`). Use this to try the flow end to end today.
- Set a real key → guests pay via Stripe Checkout before the booking is
  created. For production also:
  - deploy both apps (see channel-manager README Phase 4 notes),
  - set `NEXT_PUBLIC_SITE_URL` to the public URL,
  - optionally add a Stripe webhook for bullet-proof confirmation if guests
    close the success page early (the current flow confirms on redirect).

## Guest portal (/portal)

Guests log in with **booking reference + surname** (works for Booking.com,
Expedia, and direct `DIRECT-…` references). Lookup checks, in order: the
TTLock pipeline's `checkin_data.json` (door codes), `reservation_status.csv`,
and the channel-manager DB. Sessions are HMAC-signed cookies (`PORTAL_SECRET`).

Inside the portal:

- **Check-in instructions** — address, times, room, and the TTLock **door
  code** (shown from arrival day; before that, a "ready" note).
- **Extras & offers** — early check-in 1pm (£10), late check-out to 1pm
  (£10/hr), parking (£4.25/night + £10 per use), luggage drop (£5/night),
  laundry (£10), room clean & linen change (£10), free towel exchange, and
  vented AC units on request. Prices are computed server-side.
- Paid extras go through **Stripe Checkout** (metadata.reservation_code = the
  booking ref, so the Apps Script webhook can match). Without a Stripe key
  they're recorded as pay-on-arrival requests.
- All requests land in `.data/extras-requests.json` (booking ref, extra,
  date/time, price, paid/requested status) — check it for incoming requests.

## Config (`.env`)

| var | meaning |
|---|---|
| `CHANNEL_MANAGER_URL` | channel manager base URL (default http://localhost:3000) |
| `CM_DB_PATH` | channel-manager SQLite file, read-only, used only to feed quote.py |
| `QUOTE_DIR` | folder containing `quote.py` and `data/` |
| `RESERVATION_STATUS_PATH` | latest reservation_status.csv (TTLock pipeline export) |
| `PYTHON_BIN` | python interpreter (default `python3`) |
| `PHOTOS_DIR` | Operations/Properties folder for `npm run import-photos` |
| `STRIPE_SECRET_KEY` | empty = test mode |
| `STRIPE_WEBHOOK_SECRET` | enables `/api/stripe-webhook` — INSTANT payment confirmation (extras, direct bookings, phone-booking links). Stripe Dashboard → Webhooks → add `https://www.streathamrooms.co.uk/api/stripe-webhook` with events `checkout.session.completed` + `checkout.session.expired`, copy the signing secret here |
| `PORTAL_SECRET` | signs guest-portal session cookies |
| `CHECKIN_DATA_PATH` | TTLock pipeline checkin_data.json (door codes) |
| `PROPERTY_ADDRESS` | shown in check-in instructions |

## Room content

Photos: `public/rooms/<slug>/` (re-run `npm run import-photos` after adding
photos to the Operations folder). Descriptions/amenities: `lib/content.ts`,
keyed by the channel-manager room type *name* — IDs are resolved live, so
reseeding the DB won't break the site.

## Calendar extras: Vented AC & Parking

Booked like rooms, with a 30-day availability/price calendar in the portal:

- **Vented AC** — 5 units, 3 permanently unavailable → guests see "2/5 left"
  (the 2 sellable units track real bookings). Nightly price £10–£30 from the
  same formula as the GAS pricing script: 80% weather (Google Weather API,
  seasonal-average fallback), 20% demand (average Streatham nightly rate from
  the channel manager), + £20 one-off installation.
- **Parking** — 1 space/night (`PARKING_SPACES`). Nightly price =
  min(£25, max(£8, avg nightly rate × 12%)) − £2, + £5 per-use fee. (This is
  the GAS model that replaced the old £4.25 + £10 pricing.)
- Availability = sellable units − overlapping confirmed/paid extras bookings.
- Server-side re-pricing and re-checking on submission; sold-out dates are
  unclickable.

## Extras operations

- **Auto-accepted**: requests confirm instantly (paid ones on payment).
- **11am cutoff**: same-day services (cleaning, laundry, towels, luggage,
  early check-in, late check-out) must be booked & paid before 11am
  Europe/London; later attempts are rejected with a clear message.
- **100% refundable** is shown on cleaning, early check-in, late check-out and
  luggage storage (and on the Stripe Checkout line).
- **Hand-off to CRM/channel manager**: every request is written to BOTH
  `.data/extras-requests.json` and `.data/extras-requests.csv`
  (request_id, booking_reference, guest, extra, date, time, nights, price,
  status, stripe_session, created_at). The channel-manager agent should poll
  the CSV and: add tasks to the CRM task list, and attach the extra to the
  matching reservation row (match on `booking_reference`).

## Going live (Cloudflare Tunnel on the Mac mini)

Domain: **www.streathamrooms.co.uk** → this site. The Mac mini keeps running
both apps; the tunnel exposes only the booking site.

1. `brew install cloudflared`
2. Move the domain's DNS to Cloudflare (free plan): add site in the Cloudflare
   dashboard, set the two Cloudflare nameservers at your registrar.
3. `cloudflared tunnel login` → `cloudflared tunnel create streatham`
4. Route the hostname: `cloudflared tunnel route dns streatham www.streathamrooms.co.uk`
5. Config `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: streatham
   credentials-file: /Users/charliemcconnell/.cloudflared/<TUNNEL_ID>.json
   ingress:
     - hostname: www.streathamrooms.co.uk
       service: http://localhost:4100
     - service: http_status:404
   ```
6. Run as a service: `sudo cloudflared service install`
7. Set `NEXT_PUBLIC_SITE_URL=https://www.streathamrooms.co.uk` in `.env`,
   rebuild and run production: `npm run build && npm run start`
8. Keep both apps alive across reboots (e.g. `pm2` or launchd; `npm i -g pm2`,
   `pm2 start npm --name cm -- run start` in each app folder, `pm2 save`).

Do NOT redirect the other 4 domains here yet — the site is Streatham-only.

## Known limitations / next steps

- Segment bookings carry the physical room in *notes*; allocate them to the
  named room in the channel-manager admin (the API doesn't accept physicalRoom yet).
- Guest-initiated cancellation isn't built (admin cancels in the channel manager).
- ~~Stripe webhook recommended before going live~~ — built: `/api/stripe-webhook`
  (set `STRIPE_WEBHOOK_SECRET`, see Config). Confirms payments the second they
  happen even if the guest closes the tab, and marks channel-manager
  phone-booking links paid/expired instantly.
