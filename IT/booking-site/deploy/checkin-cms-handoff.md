# Check-in → CMS Data Handoff

For the **channel-manager / CMS** agent. Describes the data the online check-in
flow (`/checkin` on the booking site) produces, where it currently lives, and a
proposed API contract so the CMS can ingest it and show it to staff live.

Booking-site is multi-tenant: one app serves all 5 properties by domain. Every
record below is keyed by **booking reference** (`ref`). Ref formats in the wild:
`BDC-…` (Booking.com), Expedia refs, and `DIRECT-…` (direct site bookings).

---

## What the check-in flow produces

### 1. Check-in contact record (Step 1–2)
Currently written to `.data/checkin-contacts.json` on the booking-site host,
keyed by `ref`. Source of truth: `lib/checkinContacts.ts`.

| Field | Type | Notes |
|---|---|---|
| `ref` | string | booking reference (match key) |
| `contactMethods` | array of `{method, value}` | `method` ∈ `phone\|email\|whatsapp`; ≥1; `value` is the number/email |
| `earlyCheckin` | `null \| "1pm" \| "2pm"` | guest's early check-in choice |
| `earlyCheckinPrice` | number \| null | display price at selection (£); authoritative price is on the paid extra (below) |
| `parking` | boolean | guest wants parking (dates/price captured on the extra) |
| `luggage` | `{date, nights, time}` \| null | luggage drop-off request |
| `cardSaved` | boolean | true once the guest pays check-in extras via Stripe `setup_future_usage:'off_session'` — i.e. the card is on file for the £80 deposit hold |
| `savedAt` | ISO datetime | when Step 2 was submitted |

Step 1 confirmation (guest confirmed name + check-in/out dates): currently the
lookup just sets a signed session cookie; a `confirmedAt` flag can be added to
this record if the CMS wants it — say so. (Lookup key = first name + last name +
check-in date + check-out date; no booking ref entered by the guest.)

### 2. Extras requests (Step 3 — early check-in, parking, luggage)
Written via `addRequest()` to `.data/extras-requests.json` **and**
`.data/extras-requests.csv`. One row per extra.

| Field | Type | Notes |
|---|---|---|
| `ref` / booking_reference | string | match key |
| `guestName` | string | |
| `extraId` | string | `early-checkin` \| `parking` \| `luggage` \| (existing portal extras) |
| `extraName` | string | human label |
| `date` | date | service date |
| `time` | string \| null | e.g. `13:00`, luggage drop time |
| `nights` | int \| null | parking/luggage duration |
| `price` | number | £ charged (authoritative) |
| `status` | string | `pending-payment` → `paid` (Stripe), or `confirmed` (test mode / £0), `requested`, `pay-on-arrival` |
| `stripeSession` | string \| null | Stripe Checkout session id |
| (`request_id`, `created_at` in the CSV) | | |

Payment confirmation: paid extras go through Stripe Checkout; the
`stripe-webhook` route flips `pending-payment` → `paid`. The CMS should treat
`paid` as final.

### 3. Security deposit (already owned by the pipeline — context)
The deposit is NOT created by the website. The existing
`run_reservation_pipeline.py` creates a Stripe deposit (£80 × rooms, a
manual-capture hold) and writes `stripeLink` + `stripeStatus` per booking into
`checkin_data.json`. The website only **reads** `stripeStatus` to gate the room
number (secured set: `hold_active`, `captured`, `paid`, `succeeded`). If the CMS
wants deposit state, read it from the pipeline's `checkin_data.json`, not the
website. The website adds one related signal: `cardSaved` (above), meaning the
guest's card is saved off_session so the deposit can be taken automatically.

---

## Proposed integration (preferred: push from site → CMS)
The check-in spec calls for posting to the CMS API as each step completes, so
staff see it live rather than the site only writing local files. Proposed:

- **CMS exposes** an authenticated endpoint, e.g.
  `POST /api/checkin/upsert` with header `Authorization: Bearer <API_KEY>`.
- **Body** = `{ ref, property, contact: {…}, extras: [ … ], cardSaved, updatedAt }`
  (the fields above). **Idempotent upsert keyed by `ref`** — the site may POST
  the same ref multiple times as the guest progresses (Step 2 submit, each extra
  paid). CMS should merge, not duplicate.
- **When the site calls it:** (a) on Step 2 submit (contact + selections),
  (b) when an extra becomes `paid` (from the Stripe webhook), (c) optionally on
  Step 1 confirm.
- **Match to reservation** on `ref`; attach the data to the existing reservation
  row + raise a CRM task for staff where useful (e.g. early check-in requested).

If the CMS would rather **pull**, the booking-site can instead expose a read
endpoint or the CMS can poll the `.data/*.json|csv` files — but push is cleaner
and matches "CMS is source of truth, staff see it live."

---

## What the CMS agent needs to decide / provide
1. **Push or pull?** (Recommended: push — give us the endpoint URL + API key.)
2. **Endpoint shape + auth** for the upsert (so @CODE can wire the booking site
   to call it).
3. Whether to ingest **Step 1 confirmation** (needs a small `confirmedAt` add on
   the site) and **deposit status** (else CMS reads `checkin_data.json`).
4. How extras should appear in the CRM (line items on the reservation? tasks?).

Once the CMS endpoint exists, @CODE wires the booking site's check-in routes
(`/api/checkin/contact`, the extras webhook) to POST to it.

---

## File map (for the CMS developer)
All paths under `/Users/charliemcconnell/ttlock-auto-codes/IT/booking-site/`.

**Step 1 — Find the reservation**
- `app/checkin/page.tsx` — check-in page shell, renders all 3 steps (step query param)
- `app/api/checkin/lookup/route.ts` — lookup by first+last+check-in+check-out date; sets signed session cookie
- `lib/portal.ts` — booking lookup helpers (`findBookingByRef`, guest-detail match), HMAC token sign/verify, `addRequest()`

**Step 2 — Check-in form (contact + selections)**
- `app/checkin/CheckinContactForm.tsx` — the form UI (contact methods, early check-in, parking, luggage)
- `app/api/checkin/contact/route.ts` — parses + saves Step 2
- `lib/checkinContacts.ts` — `CheckinContact` data model + read/write → writes `.data/checkin-contacts.json`

**Step 3 — Instructions / deposit / room**
- `app/checkin/page.tsx` — blocks 1–5 (location, extras, front door, find-your-room/deposit gate, room door, kitchen handbook)
- `lib/checkinContent.ts` — per-property content: address, phone, maps, `parkingNote`, arrival notes
- Deposit link/status are read from the pipeline's `checkin_data.json` (external; via `lib/portal.ts`) — NOT created here

**Extras (early check-in, parking, luggage)**
- `app/checkin/CheckinExtrasBlock.tsx` — Step-3 "CONFIRM YOUR EXTRAS" block
- `app/portal/ExtraCard.tsx` — parking calendar component (reused)
- `app/api/checkin/extras-checkout/route.ts` — combined Stripe Checkout (`setup_future_usage:'off_session'`), writes pending requests
- `app/checkin/extras-paid/page.tsx` — post-payment return page
- `app/api/extras/route.ts`, `app/api/extras-calendar/route.ts` — existing portal extras endpoints
- `lib/extras.ts` — extras catalogue/definitions
- `lib/dynamicPricing.ts` — parking pricing · `lib/inventory.ts` — availability + `addRequest` usage
- `app/api/stripe-webhook/route.ts` — flips extra `pending-payment` → `paid`
- `lib/stripe.ts` — `stripeKeyFor(propertyId)` per-property keys

**Data outputs the CMS ingests** (under `.data/`, created at runtime on the booking-site host):
- `.data/checkin-contacts.json` — Step 1–2 contact record (keyed by `ref`)
- `.data/extras-requests.json` and `.data/extras-requests.csv` — extras requests + status
- External: `checkin_data.json` (from `run_reservation_pipeline.py`) — deposit `stripeLink`/`stripeStatus`, door codes

**Supporting**
- `lib/properties.ts` — property registry + host→property resolution (multi-tenant)
- `lib/bookings.ts` — booking helpers
