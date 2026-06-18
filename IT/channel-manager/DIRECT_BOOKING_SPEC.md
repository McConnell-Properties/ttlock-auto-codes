# Direct Booking — Shared Architecture & Responsibilities

Single source of truth for everyone working on direct booking: **web developer, CMS developer, and
Claude (Cowork + Claude Code agents).** Read this first; work to this contract. Raise changes here
rather than in side conversations.

## The one-line model
The **Turso hub is the source of truth** for availability, pricing and bookings. **Beds24 is the
channel-sync layer** beneath it (it talks to Booking.com / Expedia / Airbnb). The **direct booking
site talks only to the hub** — never to Beds24 or the OTAs directly. The hub mirrors each direct
booking into Beds24 so the OTA dates close automatically.

```
Guest → Direct site (front-end)
          │  reads availability + price
          ▼
     Hub API  (Turso = source of truth)   ──mirror booking──▶  Beds24  ──▶  Booking.com / Expedia
          │  creates booking on paid                              (closes the dates on all channels)
          ▼
     Door codes · CRM · Stripe (existing hub layers)
```

## Why this shape (the rule that prevents double-bookings)
Whoever holds availability must reflect EVERY booking. Beds24 owns OTA availability from the
bookings it holds; the hub owns the direct calendar. They stay consistent because (a) OTA bookings
flow Beds24 → hub in real time, and (b) every non-OTA booking (direct/phone) is mirrored hub →
Beds24 in real time. A direct booking that isn't mirrored to Beds24 = an OTA date left open that
should be closed = an oversell. So the mirror is not optional.

## The interface (freeze this — it's the seam between front-end and back-end)
Base URL: `https://mcconnell-cm.vercel.app`. Auth: Bearer API key, **called server-side only**
(never expose the key in the browser).

- **`GET /api/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&property=<id>&adults=2&children=0[&promo=CODE]`**
  → returns each available room type with `available` (units left) and the full price breakdown
  (direct discount, length-of-stay discount, guest fees, promo, `totalPrice`). **Use these numbers
  as-is; do not compute pricing on the front-end.**
- **`POST /api/bookings`** (call only AFTER payment confirms) → body
  `{ roomTypeId, guestName, checkIn, checkOut, adults, children, email, phone, units, totalPrice, channel: "direct" }`.
  Validates availability, creates the booking, and (via the hub) mirrors it into Beds24 to close the
  OTA dates. Returns `201 {bookingId}` or `409 "not enough availability"` (room just sold — handle
  gracefully).

## Responsibilities (clear layers; the API is the boundary)

**Web developer — the front-end booking flow**
- Search UI, room/price display, date/guest selection, checkout, Stripe payment UI.
- Calls the hub API **server-side** (keeps the key safe).
- Implements the **checkout hold UX** (see below) and handles the `409` "just sold" case.
- Owns nothing in the hub DB or Beds24 — consumes the API only.

**CMS developer — the hub back-end**
- The `/api/availability` and `/api/bookings` endpoints (they exist — extend, don't replace).
- The **checkout hold/lock**: a short-lived hold (e.g. a temporary Block with a TTL) created when a
  guest enters checkout, released on payment or expiry, so two guests can't grab the last unit.
- **Stripe**: a booking is created only on confirmed payment (Stripe webhook → create booking).
- Stores `beds24Id` on each booking; coordinates with the mirror (below).
- Must not break the shared modules that feed channel sync (`lib/data.ts`, `lib/availability.ts`,
  `lib/allocate.ts`) — see `CMS_AGENT_BRIEF.md`.

**Claude (Cowork + Claude Code agents) — the Beds24 side**
- The **direct → Beds24 mirror** (create/cancel/modify a Beds24 booking when the hub changes a
  non-OTA booking), with retry so a mirror is never silently dropped. (Tracked in `AGENT_HANDOFF.md`,
  CC-B.)
- Beds24 availability correctness (Beds24 owns availability from its bookings; hub pushes prices only).
- Channel mapping, Beds24 config, and keeping the integration honest end-to-end.

## Sequence of a direct booking (the happy path)
1. Guest searches → front-end calls `GET /api/availability` (server-side) → shows rooms + prices.
2. Guest picks a room and enters checkout → front-end asks the hub to **place a hold** on that
   room/dates (TTL, e.g. 15 min).
3. Guest pays via Stripe → Stripe webhook fires → hub **creates the booking** (`channel:"direct"`),
   releases the hold.
4. Booking creation **mirrors into Beds24** → OTA dates close within seconds.
5. Existing hub layers run: door code, CRM, confirmation.
6. If the guest never pays, the hold expires and the room reopens.

## Non-negotiables (safety)
- Create the booking **only on confirmed payment**, server-side, the moment payment succeeds.
- **Always** mirror a direct booking into Beds24 (and cancel the mirror if the booking is cancelled).
- **Hold the room during checkout** so concurrent checkouts can't both take the last unit.
- The API key is **server-side only**.
- Hub is the source of truth — the front-end never writes to Beds24 or the OTAs directly.

## How we work together (to actually stay on the same page)
1. **This doc is the contract.** Any change to the API shape, responsibilities, or flow gets edited
   here first, then everyone pulls.
2. **The API is the seam.** Once the two endpoints above are frozen, the web dev and CMS dev can
   build in parallel without blocking each other — front-end against the documented contract,
   back-end behind it.
3. **`AGENT_HANDOFF.md`** is where the Claude Code agents log Beds24/mirror progress; CMS dev and I
   coordinate there on `beds24Id` and the mirror.
4. **Open decisions** (resolve together, record here):
   - Hold mechanism: temporary `Block` with TTL vs a dedicated holds table? (CMS dev to propose.)
   - Payment timing: confirm Stripe webhook → create-booking is the trigger (not on-submit).
   - Deposit vs full payment for direct (ties into the existing Stripe deposit flow).

## Status / what's built already
- `GET /api/availability` and `POST /api/bookings` exist and return direct-booking pricing + queue
  the booking. ✅
- The hub→Beds24 mirror for non-OTA bookings is in progress (CC-B, see `AGENT_HANDOFF.md`). 🛠️
- Checkout hold + Stripe-webhook-create-booking: **to build** (CMS dev). ⬜
- Front-end booking flow: **to build** (web dev). ⬜
