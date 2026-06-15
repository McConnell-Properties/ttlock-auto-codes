# Channel Manager — Integration API

Contract for the direct booking website. Base URL: `http://localhost:3000` in dev (or 3001 — check the dev server output). All dates are `YYYY-MM-DD`; check-out is exclusive. No auth yet (local only) — auth lands when we deploy.

**Source of truth:** the channel manager owns availability, bookings, and pricing rules. The booking site must never compute availability **or prices** itself — always call `/api/availability` right before showing bookable rooms (it returns the final price with all rules applied), and create bookings only via `POST /api/bookings` (which re-validates and will 409 if the room sold while the guest was paying).

## Pricing rules (applied server-side — do not reimplement)

- Nightly rates come from Charlie's Google Sheet (synced into the channel manager).
- **Length-of-stay discount** off the accommodation total: 2+ nights −20%, 3+ −26%, 5+ −32%, 7+ −35% (highest tier wins).
- **Extra-guest fees** per night: base occupancy 1 adult; +£5 per extra adult, +£2.50 per child.
- `totalPrice = baseTotal − losDiscount + guestFees`. The API returns the full breakdown so the site can display "was/now" pricing and fee lines.

## GET /api/properties

Properties and their room types (static info for building search/landing pages).

```json
{
  "properties": [
    { "id": "streatham", "name": "Streatham Rooms",
      "roomTypes": [ { "id": 1, "name": "Triple Room with Private Bathroom", "totalUnits": 2, "basePrice": 80 } ] }
  ]
}
```

## GET /api/availability?checkIn=2026-07-01&checkOut=2026-07-08&adults=2&children=1[&property=streatham]

Live availability + full quote per room type. `adults` defaults 1, `children` 0. `available` = bookable units for the whole stay (min across nights, after bookings and manual blocks). Filter out `available: 0` rows in the UI.

```json
{
  "checkIn": "2026-07-01", "checkOut": "2026-07-08", "adults": 2, "children": 1,
  "results": [
    { "propertyId": "streatham", "propertyName": "Streatham Rooms",
      "roomTypeId": 1, "roomTypeName": "Triple Room with Private Bathroom",
      "available": 1, "nights": 7,
      "baseTotal": 455, "losPct": 35, "losDiscount": 159.25,
      "guestFees": 52.5, "totalPrice": 348.25 }
  ]
}
```

Errors: `400` bad/missing dates.

## POST /api/bookings

Create a confirmed booking. Call this **after** payment succeeds (Stripe webhook / success handler). It re-checks availability and queues inventory decrements for Booking.com/Expedia automatically — the booking site does not deal with OTAs at all.

Request:

```json
{
  "roomTypeId": 1,
  "guestName": "Jane Smith",
  "checkIn": "2026-07-01",
  "checkOut": "2026-07-08",
  "adults": 2,                        // optional, default 1
  "children": 1,                      // optional, default 0
  "email": "jane@example.com",       // optional
  "phone": "+44 7700 900000",         // optional
  "units": 1,                          // optional, default 1
  "totalPrice": 348.25,                // optional — defaults to the live quote
  "channelRef": "pi_3Nxxxx",          // optional — use the Stripe payment intent / session id
  "notes": "late arrival"             // optional
}
```

Responses:
- `201` `{ "ok": true, "bookingId": 123, "quote": { ...full breakdown as above } }`
- `409` `{ "error": "not enough availability", "available": 0 }` — show "room no longer available", refund/redirect
- `400` validation message · `404` unknown roomTypeId

**Charge the guest `quote.totalPrice`** (or pass your own `totalPrice` if the site applied a promo on top — it's stored as-is).

## GET /api/bookings?status=confirmed|cancelled|all

Booking list (internal/admin use; the booking site shouldn't need it).

## Notes for the booking-site agent

- Room photos/descriptions are NOT in this system — manage those in the site's own content layer, keyed by `roomTypeId`.
- OTA rate plans/policies (occupancy pricing etc.) are configured on-platform and are out of scope — never mirror OTA pricing logic.
- Use `channelRef` to store the Stripe reference — it shows up in the admin and is the reconciliation key.
- Max occupancy validation: room types don't yet expose max guests — for now cap the guest selector sensibly per room type in the site's content layer; a `maxGuests` field can be added on request.
- Cancellations: POST is create-only; admin cancels via the UI. If the site needs guest-initiated cancellation later, ask for a `DELETE /api/bookings/:id` endpoint.
