# Build brief — Wire booking-site check-in → CMS (push to `/api/checkin/upsert`)

Make the booking-site **POST guest check-in data to the channel-manager (CMS)** as each step completes, so staff see it live in the CRM. The CMS side is already built and (being) deployed — this is the booking-site half only.

**Repo:** `booking-site` — `/Users/charliemcconnell/ttlock-auto-codes/IT/booking-site/`. (This repo is owned by the web developer — coordinate before merging.)

**Context:** the data contract + file map are in `deploy/checkin-cms-handoff.md`. Read it. This brief is the concrete wiring task.

---

## The CMS endpoint (already exists)
```
POST {CHANNEL_MANAGER_URL}/api/checkin/upsert
Header: Authorization: Bearer {CM_API_KEY}
Content-Type: application/json
```
- `CHANNEL_MANAGER_URL` = the deployed admin, `https://mcconnell-cm.vercel.app`.
- `CM_API_KEY` = the shared key (same one used elsewhere for CM calls). Confirm both are set in the booking-site env (Vercel + local `.env`); if `CHANNEL_MANAGER_URL`/`CM_API_KEY` aren't there yet, add them.
- **Idempotent + merge:** you may POST the same `ref` multiple times; the CMS merges, never duplicates. So every call is "upsert the current known state for this ref."
- Response: `{ ok, matched: true|false, bookingId? }`. `matched:false` just means the booking isn't in the CMS yet — **not an error**; don't break the guest flow on it.

## Body shape
```json
{
  "ref": "BDC-5149920930",
  "property": "streatham",
  "confirmedAt": "2026-06-14T10:00:00Z",
  "contact": {
    "contactMethods": [{ "method": "whatsapp", "value": "+447…" }],
    "earlyCheckin": "1pm",
    "parking": true,
    "luggage": { "date": "2026-06-20", "nights": 1, "time": "13:00" },
    "cardSaved": true,
    "savedAt": "2026-06-14T10:05:00Z"
  },
  "extras": [
    { "extraId": "early-checkin", "extraName": "Early check-in 1pm", "date": "2026-06-20",
      "time": "13:00", "nights": null, "price": 20, "status": "paid", "stripeSession": "cs_…" }
  ],
  "updatedAt": "2026-06-14T10:05:00Z"
}
```
All sub-objects optional except `ref` — send what you have at each trigger. Field names map straight through (the CMS turns `extraId→extra`, `status→sourceStatus`). `property` comes from the multi-tenant host resolver (`lib/properties.ts`).

---

## What to build

### 1. A small client helper — `lib/cm.ts` (or `lib/cmCheckin.ts`)
`postCheckinUpsert(payload)`:
- Reads `CHANNEL_MANAGER_URL` + `CM_API_KEY` from env; if either is missing, no-op + warn (so local dev without the CMS still works).
- POSTs JSON with the Bearer header, ~5s timeout.
- **Best-effort:** wrap in try/catch; on failure log a warning and return — **never throw into the guest request path.** Keep writing the existing `.data/*` files regardless, so nothing is lost if the CMS is down.

### 2. Trigger points (per the file map)
- **Step 2 submit** — `app/api/checkin/contact/route.ts`: after the contact record is saved to `.data/checkin-contacts.json`, call `postCheckinUpsert({ ref, property, contact, updatedAt })`. This is what sets `preArrivalCompletedAt` + contact/arrival/cardSaved in the CRM.
- **Extra paid** — `app/api/stripe-webhook/route.ts`: when an extra flips `pending-payment → paid`, call `postCheckinUpsert({ ref, property, extras: [thatExtra], updatedAt })` so the paid extra lands as a line item. (Send on `paid` — that's the state the CRM actions on.)
- **Step 1 confirm (optional)** — `app/api/checkin/lookup/route.ts`: when the guest confirms name + dates, add a `confirmedAt` timestamp to the contact record and `postCheckinUpsert({ ref, property, confirmedAt })`. (Small add — the lookup currently only sets the session cookie.)

### 3. Don't change the guest-facing flow
Only add the outbound push (+ the optional `confirmedAt` field). No UI changes, no change to what the guest sees or to the existing `.data` writes.

---

## Test (report PASS/FAIL)
1. Complete Step 2 for a real `ref` → CRM shows that booking's arrival time, contact method/value, card-saved, and a "completed" pre-arrival chip; `matched:true` returned.
2. Pay for an extra (Stripe **test mode**) → webhook fires → the extra appears in the CRM extras panel as `paid`; re-firing the webhook doesn't duplicate it.
3. Re-submit Step 2 for the same `ref` → no duplicate CRM/extras rows (CMS merges).
4. Point `CHANNEL_MANAGER_URL` at an unreachable host → guest flow still completes, `.data` files still written, warning logged (no 500 to the guest).
5. Unknown `ref` → `matched:false`, no error surfaced to the guest.

Build on a branch; coordinate with the web developer before merge. Stop and report if the env vars aren't present or the endpoint returns 401 (key mismatch).
