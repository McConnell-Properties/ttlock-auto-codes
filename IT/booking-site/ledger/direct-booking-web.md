# Booking-Site Deployment Ledger

## 2026-06-17 — Stripe per-property keys pushed to Vercel (project-bt46l)

### Variables added

| Variable | Environments |
|----------|-------------|
| `STRIPE_SECRET_KEY_STREATHAM` | Production, Preview |
| `STRIPE_SECRET_KEY_VALNAY` | Production, Preview |
| `STRIPE_SECRET_KEY_SEAMLESS` | Production, Preview |
| `STRIPE_SECRET_KEY_DEPOSITS` | Production, Preview |
| `STRIPE_WEBHOOK_SECRET_DEPOSITS` | Production, Preview |

**Notes:**
- `STRIPE_SECRET_KEY_VALNAY` — copied from the legacy `STRIPE_SECRET_KEY` fallback (same account).
- `STRIPE_SECRET_KEY_DEPOSITS` — uses the Valnay Stripe account as the shared deposits account.
- `STRIPE_WEBHOOK_SECRET_DEPOSITS` — for the endpoint `https://www.streathamrooms.co.uk/api/webhooks/deposits` (handles all properties' deposit events via the single Valnay/deposits account).
- Previously set (Production only, unchanged): `STRIPE_SECRET_KEY_GASSIOT`, `STRIPE_WEBHOOK_SECRET_GASSIOT`, `STRIPE_WEBHOOK_SECRET_VALNAY`, `STRIPE_WEBHOOK_SECRET_SEAMLESS`.

### Deployment

- **URL:** `https://project-bt46l-brku26xfj-mc-connell-enterprises-ltd.vercel.app`
- **Status:** Ready — Production
- **Duration:** 43s

### Verification

`vercel env ls | grep -i deposit` confirmed both deposit vars listed as Encrypted in Production and Preview.

### Still outstanding

- `STRIPE_SECRET_KEY_TOOTING` + `STRIPE_WEBHOOK_SECRET_TOOTING` (Tooting not yet set up)
- `STRIPE_WEBHOOK_SECRET_STREATHAM` (webhook endpoint not yet added in Streatham Stripe account)
- `DEPOSIT_FROM_CMS` — set to `1` to activate portal-side deposit creation once deposits account is fully tested
- `PROCESS_DEPOSITS_SECRET` — set a random string and configure a cron trigger (launchd or Vercel Cron) for `/api/checkin/process-due-deposits`
