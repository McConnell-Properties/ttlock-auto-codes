# Build brief — Check-in ingestion API (booking-site → CMS)

Build the CMS endpoint that ingests the online check-in data the booking-site produces, so staff see it live in the CRM. Self-contained — you don't need any other handoff doc.

**Repo:** this one, `channel-manager` (Next.js 14 / TS, `@libsql/client`, all SQL in `lib/data.ts`, cloud DB = **Turso prod**). Run from `/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager`.

> ⚠️ **SHARED ENDPOINT — coordinate.** The guest-journey CRM BUILD SPEC (in `AGENT_HANDOFF.md`) defines a `POST /api/crm/prearrival` that ingests the *same* guest data. **Do not create two competing routes.** Build **one** endpoint, `POST /api/checkin/upsert`, and treat it as the canonical guest check-in ingest; if another session has already made `/api/crm/prearrival`, extend that one instead and note it. Whoever wires the booking site must point at this single route.

---

## Decisions already made (by the CMS/DESKTOP side) — implement as given
1. **Push, not pull.** The site POSTs to us.
2. **Auth:** reuse the existing `CM_API_KEY` Bearer scheme. `middleware.ts` already enforces `Authorization: Bearer <CM_API_KEY>` (or an admin cookie) for all `/api/*`, so the new route is auto-protected — no per-route auth code needed.
3. **Match key:** booking **`channelRef`** = the site's `ref` (`BDC-…`, Expedia, `DIRECT-…`).
4. **Deposit stays pipeline-owned.** Do NOT ingest deposit state from the site. We already read `stripeStatus` from the pipeline's `checkin_data.json` via `lib/messaging.ts`. From the site we only take the **`cardSaved`** flag (card saved off_session for the £80 hold).
5. **Step-1 confirmation:** ingest `confirmedAt` when present.
6. **Extras → line items** on the reservation via the existing `ExtrasRequest` table; they already surface in the CRM "Operations — extras" panel. Treat `paid` as final.

---

## Safety
- **Production Turso DB.** Migration is **additive only**. Self-load `.env` in the migration script (pattern in `db/sync-cli.mjs` / `queue-inventory.mjs`) so it targets Turso, not `db/dev.db`.
- **Idempotent.** The site POSTs the same `ref` multiple times (Step 2 submit, each extra paid). **Merge, never duplicate.**
- No Stripe calls in this endpoint — it only records what the site tells us.

---

## Input contract (what the site sends)
`POST /api/checkin/upsert`, `Authorization: Bearer <CM_API_KEY>`, body:
```json
{
  "ref": "BDC-5149920930",
  "property": "streatham",
  "confirmedAt": "2026-06-14T10:00:00Z",        // optional (Step 1)
  "contact": {
    "contactMethods": [{ "method": "whatsapp", "value": "+447…" }],  // ≥1; method ∈ phone|email|whatsapp
    "earlyCheckin": "1pm",                        // null | "1pm" | "2pm"
    "parking": true,
    "luggage": { "date": "2026-06-20", "nights": 1, "time": "13:00" }, // or null
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
All sub-objects optional except `ref` — a Step-1-only call may carry just `ref` + `confirmedAt`; a Step-2 call carries `contact`; extras arrive as they're paid.

---

## 1. Schema migration — `db/migrate-checkin-fields.mjs`
Idempotent (catch "duplicate column name"); run vs cloud + local. Add to `CrmRecord` (PK `bookingId`, 1:1 with Booking):
- `arrivalTime TEXT`
- `contactMethod TEXT`        — phone|email|whatsapp (primary method)
- `contactValue TEXT`
- `cardSaved TEXT NOT NULL DEFAULT ''`            — '' | yes | no
- `preArrivalCompletedAt DATETIME`               — set when `contact`/Step-2 is received
- `confirmedAt DATETIME`                          — set from Step-1 confirm
- `preArrivalNotes TEXT`                          — luggage/early-checkin summary or free notes

These are the **same columns** the guest-journey spec needs — if that migration runs too, don't duplicate; reconcile. Add all new fields to `CRM_FIELDS`, the `CrmRecord` type, and `CrmRow` in `lib/data.ts` (`upsertCrm` whitelists by `CRM_FIELDS`).

`ExtrasRequest` already exists with the right shape (`bookingReference, bookingId, extra, date, time, nights, price, sourceStatus, taskStatus, raw, importedAt`) and a UNIQUE dedupe index on `(bookingReference, extra, date, time)` — **no schema change needed for extras**; use that index for upsert.

## 2. Data helpers — `lib/data.ts`
- `findBookingByRef(ref)` → returns `{ id, property, … } | null` matching `Booking.channelRef = ref`.
- `upsertCheckin(ref, payload)`:
  - Resolve booking via `findBookingByRef`.
  - **If matched:** `upsertCrm(bookingId, {...})` mapping: primary `contactMethods[0]` → `contactMethod`/`contactValue`; `cardSaved` → 'yes'/'no'; `confirmedAt`; set `preArrivalCompletedAt` when `contact` is present; build `preArrivalNotes` from early-checkin/parking/luggage; `arrivalTime` if the site sends one. Merge — only overwrite fields present in this payload.
  - **Extras:** upsert each into `ExtrasRequest` keyed by the unique index — `INSERT … ON CONFLICT(bookingReference, extra, COALESCE(date,''), COALESCE(time,'')) DO UPDATE SET price=…, sourceStatus=status, bookingId=…`. Map `extraId|extraName`→`extra`, `status`→`sourceStatus`. Don't reset `taskStatus` (staff-owned) on update.
  - **If NOT matched:** still upsert the extras (they're `bookingReference`-keyed; leave `bookingId` null) so nothing is lost; skip the CrmRecord write; return `matched:false` so the site/staff know. (A later reservation import can backfill `bookingId`.)
- Keep all writes parameterised.

## 3. Route — `app/api/checkin/upsert/route.ts`
Follow `app/api/bookings/route.ts` exactly (`export const dynamic = 'force-dynamic'`, parse JSON with a 400 on failure). Validate `ref` is a non-empty string; validate contact methods if `contact` present (≥1, method in the enum). Call `upsertCheckin`. Return `{ ok:true, matched:true|false, bookingId? }` (200), `{error}` 400 on bad body. Auth is handled by `middleware.ts` — don't re-implement it, but DO confirm the route sits under `/api/` so the middleware matcher catches it.

## 4. CRM display (minimal, additive — `app/crm/board.tsx` / `lib/data.ts`)
Extras already render via `extrasTasks()` + the Operations panel — verify ingested rows appear there. Add to the pre-arrival/guest area: a **"pre-arrival" chip** ("completed {preArrivalCompletedAt}" else "awaiting"), and show **arrival time, contact method+value, card-saved**. Surface an actionable flag where useful (e.g. early check-in requested). Keep it consistent with the planned 3-stage redesign so it folds in.

## 5. Test checklist (report PASS/FAIL with verbatim output)
1. Migration idempotent on cloud + local; `CrmRecord` has the new cols; Booking/CrmRecord/ExtrasRequest counts otherwise unchanged.
2. POST with a real `ref` + `contact` → 200 `matched:true`; CRM shows arrival time, contact, card-saved, and a "completed" pre-arrival chip; `preArrivalCompletedAt` set.
3. POST the **same ref again** with one extra `paid` → no duplicate CrmRecord, no duplicate ExtrasRequest row (dedupe index holds); extra shows `paid`.
4. POST an unknown `ref` → 200 `matched:false`; extras stored with null `bookingId`; no error.
5. `confirmedAt`-only (Step 1) POST sets `confirmedAt` and nothing else.
6. Bad body (missing `ref`, or bad contact method) → 400.
7. No regression on `/api/bookings`, `/api/availability`, `/api/properties`.

Build on a branch, test locally + against cloud read paths, and **stop for review before `vercel --prod`**. Flag anything that overlaps the guest-journey `/api/crm/prearrival` build so we don't ship two routes.
