# Deposit flow — agreed handoff (CMS ⇄ booking-site)

Consolidates the coordination doc + Charlie's decisions into one build agreement. Goal: the £80 refundable deposit (a **hold** for credit cards, a **charge** for debit cards) is created once, on an account the CMS can release/refund from.

## Decisions (Charlie — final)
1. **One shared "deposits" Stripe account.** All £80 holds for all properties live on a single account the CMS owns. (Not per-property restricted keys.)
2. **Booking-site runs the scheduler** (Vercel Cron) that creates each hold on the timing rules.
3. **Accepted trade-off:** the off_session card saved on the *per-property* account is **not** reused — the guest authorises the £80 hold afresh on the shared deposits account (one extra tap). No silent/no-tap hold.

## Human prerequisite
- **Create the shared "deposits" Stripe account** in the dashboard, get its secret key. Share that key to **both** sides: booking-site (to create holds) and CMS (to capture/release). This is the account `STRIPE_SECRET_KEY` resolves to on the CMS, and a dedicated `STRIPE_SECRET_KEY_DEPOSITS` (or equivalent) on the booking-site — **distinct from the per-property keys** the site uses for extras.

## Booking-site (web dev / Claude Code)
- **Create** the £80 deposit on the **shared deposits account** key (not `stripeKeyFor(property)`), **routing by card type** read from `card.funding` when the guest enters their card:
  - **credit → manual-capture HOLD** (free).
  - **debit → £80 CHARGE** (collected now; the CMS refunds it after checkout — accepted ≈£2 Stripe fee).
  - **prepaid → block**, ask for another card.
  - **Enforce by detection, not the guest's choice.** If you show a credit/debit choice, validate the actual `card.funding` and re-route — a debit entered on the "credit" path goes to the charge flow. (Otherwise a guest just clicks "credit" with a debit to dodge the charge.)
- **Display both scenarios** to the guest for transparency: *"Credit card — we place a refundable £80 hold. Debit card — we take £80 and refund it within ~5–10 days of checkout."* The card they actually enter decides which runs.
- **Timing:** Vercel Cron, per `deploy/checkin-flow-spec.md` rules (1n −4d, 2n −3d, 3n −2d, 4n −1d, 5n day-of, 6n+ −5d before checkout; at 3pm). Create the deposit when timing is met.
- **Metadata** on the PI: `type=deposit`, `bookingRef`, `property`, `amount`, `mode`.
- **Report to CMS:** `POST {CHANNEL_MANAGER_URL}/api/checkin/upsert` (Bearer `CM_API_KEY`) with `deposit: { paymentIntent, status, amount, mode }` (`mode` = `hold` for credit, `charge` for debit) on authorisation and on any status change. The CMS uses `mode` to decide **cancel** (hold) vs **refund** (charge) at checkout.
- **Guest-facing:** keep surfacing status + gating the room number (already built).
- **Cutover:** behind a flag — switch the status source the site reads from `checkin_data.json` → the CMS; keep `checkin_data.json` as fallback during transition; retire the pipeline's `stripeLink` last.

## CMS (channel-manager / CMS agent) — see `DEPOSIT_PREAUTH_BRIEF.md`
- `STRIPE_SECRET_KEY` = the **shared deposits account** (single key — it can capture/cancel any deposit PI by id; no per-property handling).
- **Ingest** the PI via `/api/checkin/upsert` → `CrmRecord` (`depositPaymentIntent`/`depositStatus`/`depositAmount`); never downgrade a secured status.
- **Manage:** after checkout + 2 days (unless flagged for damage), **release a `hold` (cancel) or refund a `charge` (refund)**; capture a hold for damage ≤ £80 (a debit charge is simply *kept*, not refunded); webhook status sync. **Damage above £80** → charge the **saved off_session card** — which is on the **per-property** account, so the CMS needs that per-property key for it (the £80 deposit stays on the shared account).

## Division of labour, one line
**Booking-site creates the deposit (hold for credit / charge for debit, on Cron) and reports `{paymentIntent, status, amount, mode}`; CMS releases-or-refunds it, and captures / off-session-charges for damage.**
