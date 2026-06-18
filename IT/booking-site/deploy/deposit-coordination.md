# Deposit flow — CMS ⇄ booking-site coordination

Answers from the **booking-site (web-dev) side** to the CMS developer's four
questions, grounded in the current code, plus the one decision only Charlie can
make. Goal: the £80 refundable hold is created once, and the CMS can
capture/release it.

## Current booking-site reality (as built)
- **Per-property Stripe keys.** `lib/stripe.ts` → `stripeKeyFor(propertyId)` reads
  `STRIPE_SECRET_KEY_<PROPERTY>`, falling back to a generic `STRIPE_SECRET_KEY`.
  Charlie's decision: **separate Stripe account per property.**
- **Card already saved off_session.** The check-in extras checkout
  (`app/api/checkin/extras-checkout/route.ts`) sets
  `payment_intent_data.setup_future_usage:'off_session'` and flags `cardSaved`
  (`lib/checkinContacts.ts`). So a card is on file **on the per-property account**.
- **The site does NOT create the deposit today.** Step 3 renders an "Authorise
  £80 deposit" button pointing at `booking.stripeLink`, which currently comes
  from the pipeline (`run_reservation_pipeline.py` → `checkin_data.json`). The
  site only reads `stripeStatus` to gate the room number.

## Answers to the four questions
1. **Same Stripe account? — THE critical one.** Deposits must live on an account
   the CMS has keys for, AND ideally the same account where the card was saved
   off_session (so a one-tap/no-tap hold is possible). Today the site is
   per-property. → **Decision needed (Charlie):** either (a) CMS holds a
   per-property **restricted key** (scoped to PaymentIntents: read + capture) for
   each property — keeps funds separated and lets one-tap work; or (b) all
   deposits go on **one shared "deposits" account** the CMS owns — simpler for
   the CMS but the off_session saved card (on the per-property account) can't be
   reused, so it'd need a fresh authorisation. **Recommend (a).**
2. **One tap or none?** Feasible — the off_session card is already saved, so the
   booking-site can create the £80 hold with **no extra guest action**, *provided*
   it's on the same account the card was saved on (i.e. per-property → option 1a).
   Cleanest split: **booking-site creates** the hold off_session (it has the
   saved card + per-property key), **CMS captures/releases** it.
3. **Deposit timing.** The stay-length rules are specced
   (`deploy/checkin-flow-spec.md`: 1n −4d, 2n −3d, 3n −2d, 4n −1d, 5n day-of,
   6n+ −5d before checkout, at 3pm). Whoever creates the hold uses these. If the
   booking-site creates it on schedule, it needs a trigger (cron/launchd) — or
   the CMS triggers creation. **Decide who runs the scheduler.**
4. **Cutover from `checkin_data.json`.** Agreed — coordinated switch, not an
   independent build. Plan: stand up the CMS capture/release + the booking-site
   off_session creation behind a flag; switch the status source the site reads
   from `checkin_data.json` → the CMS; retire the pipeline's `stripeLink` last.
   Keep `checkin_data.json` as fallback during transition.

## Proposed division of labour
- **Booking-site (web dev / Claude Code):** create the £80 PaymentIntent
  (manual capture, off_session saved card) on the property's account, tag
  metadata `type=deposit` + booking ref + amount, expose/persist the
  PaymentIntent id; surface status to the guest; gate the room number.
- **CMS:** ingest the PI id, store it, run capture / release / auto-release,
  webhook sync. Needs read+capture access on the account the PI lives on.

## The one blocking decision (Charlie)
**How does the CMS act on per-property Stripe accounts?** → per-property
restricted keys (recommended) vs one shared deposits account. Everything else
follows from this.

(CMS dev: yes — please write the short web-dev handoff note; this doc is the
booking-site side's answers to fold into it.)
