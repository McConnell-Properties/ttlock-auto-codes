# Build brief — Security deposit pre-auth (CRM display + cancel/capture + phone path)

Manage the **£80 refundable deposit hold** from the CMS: show its state in the CRM and let staff **release** or **capture** it, plus a phone/manual path. Build on the **existing** £80 pre-auth — don't create a parallel system.

**Repo:** `channel-manager`. Stripe helper exists at `lib/stripe.ts` (minimal form-encoded client: `stripePost`/`stripeGet`/`createCheckoutSession`). `Booking` has `stripeSessionId`/`stripePaymentUrl`/`stripeStatus`. The booking-site now saves the guest card off_session (`CrmRecord.cardSaved='yes'`).

> **SAFETY — read carefully.** Use **Stripe TEST MODE** for all dev/testing; never create or capture real holds on real cards while testing. Production DB migration is **additive only**. Capture **moves money** and release voids a hold — guard both, require explicit staff confirmation, and **never auto-capture**. Never store raw card numbers.

---

## PHASE 0 — Discovery (do FIRST, report, then STOP for review)
- **Where is the deposit created today and where is its PaymentIntent/session id?** The pipeline (`run_reservation_pipeline.py`) creates the £80 manual-capture hold, logs `automation-data/stripe_deposit_log.csv`, and writes `stripeStatus`/`stripeLink` into `checkin_data.json`. Determine: (a) is the **PaymentIntent id** recoverable (from the session id in the log, or via the Stripe API by `metadata.reservation_code`)? (b) does cloud `Booking.stripeStatus` already reflect deposit state, or only direct-booking payments?
- **Ownership decision (needs Charlie):** does the CMS **take over** deposit creation going forward (use the saved off_session card → one manual-capture PI the CMS controls), or keep the **pipeline** creating it and the CMS only act on the existing PI? **Recommendation:** CMS owns it going forward (it has `cardSaved` + can store the PI id), and pipeline deposit-creation is retired for site-handled bookings — but **flag this and wait**, don't assume. Beware creating a *second* hold on a booking the pipeline already held.

## PHASE 1 — Schema (`db/migrate-crm-deposit.mjs`, additive, idempotent, cloud+local)
- `depositStatus TEXT NOT NULL DEFAULT 'none'` — `none|held|captured|released|cancelled`
- `depositPaymentIntent TEXT`
- `depositAmount REAL`
Add to `CRM_FIELDS` + the `CrmRecord` type + `CrmRow`.

## PHASE 2 — Stripe helpers (`lib/stripe.ts`)
- `createDepositHold({ bookingId, amountGbp=80, reservationCode, customerId/paymentMethod })` → PaymentIntent `capture_method=manual`, confirmed **off_session** with the saved card; metadata `type=deposit, booking_id, reservation_code`. Returns PI id + status.
- `capturePaymentIntent(id, amountGbp?)` → `/payment_intents/{id}/capture` (partial allowed for damages).
- `cancelPaymentIntent(id)` → `/payment_intents/{id}/cancel` (release).
- `getPaymentIntent(id)` → status refresh.

## PHASE 3 — CRM (`app/crm/board.tsx` + `lib/actions.ts` + `lib/data.ts`)
- Deposit cell shows `depositStatus` + amount; **Capture** / **Release** buttons enabled only when `held`. Server actions → the helpers → update `depositStatus` + store the PI. Capture requires a confirm (optional amount for damages). **No auto-capture.**
- Extend `/api/stripe/webhook` to set `depositStatus` from `payment_intent` events where `metadata.type=deposit` (authorized→`held`, captured→`captured`, canceled→`cancelled`), **guarded** (never downgrade a secured state).
- **Expiry warning:** amber when a `held` PI is >6 days old (Stripe auth ~7-day expiry) — note to re-auth or capture+refund.

## PHASE 4 — Phone / manual path
- **Default (no PCI scope):** a staff "send deposit/payment link" action generating a Stripe Checkout/payment link (reuse `createCheckoutSession`) to read out or send via SMS/WhatsApp/email.
- **True MOTO** (PaymentElement in admin) **only if** Charlie enables MOTO on the Stripe account — a **HUMAN dashboard step**; flag it, don't build until confirmed.

## Tests (TEST MODE — report PASS/FAIL)
Create hold → `held`; capture → `captured`; release → `cancelled`; expiry warning shows for an aged hold; webhook updates status without downgrading; phone link generates. No double-hold on a booking the pipeline already held.

**Stop after Phase 0** for the ownership decision before building Phases 1–4.
