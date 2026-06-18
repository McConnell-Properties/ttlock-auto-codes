# Beds24 Migration Brief — swap the OTA edges, keep the hub

**Author:** DESKTOP (Cowork, no network/live-credential access — planned this; could not
call the Beds24 API from its sandbox).
**Executor:** CODE (Claude Code in this folder on the Mac — has network, live `.env`,
Turso/Vercel/Stripe access). Follow the same protocol as `AGENT_HANDOFF.md`:
append results at the bottom of that file, record every test as PASS/FAIL/SKIP with
verbatim output, and **never run destructive writes against the production Turso DB**.

---

## Decision taken (Charlie, 2026-06-15)

- **Architecture:** keep the Turso/Next.js channel-manager as the **hub**; Beds24 replaces
  only the two fragile OTA edges — inbound email-scraping and outbound browser extranet
  pushing. The hub, booking-site, quote engine, TTLock pipeline, Stripe and CRM are unchanged.
- **Scope this pass:** (1) inbound bookings + cancellations, (2) outbound availability + rates.
  TTLock re-wiring and Stripe are explicitly **out of scope** for now.
- **Cutover:** **shadow first** — run Beds24 ingestion/push in parallel, diff against the
  current system for a few days, then flip the old jobs off. Nothing destructive until the diff is clean.

### Why keep the hub (the reasoning, so you don't second-guess it)
The hub already owns 476 bookings, 8,497 rate overrides, the CRM, the quote engine, the
booking-site and the TTLock pipeline — all keyed on internal `Property.id` / `RoomType.id`.
Making Beds24 the system of record would mean re-keying all of that to Beds24 IDs: huge
surface, high risk, slow. The genuinely painful, brittle parts are exactly the two edges —
IMAP parsing of detail-less BDC emails (`poll-booking-emails.mjs` + the `EmailBookingTask`
Chrome-fetch step) and the Playwright extranet bot (`scripts/sync-inventory.mjs`). Beds24
removes both. We keep what's differentiated and working, replace what's fragile.

---

## Master sequence — how this brief interleaves with the go-live plan

The manual channel-connection work lives in **`BEDS24_GOLIVE_PLAN.md`**. It is **not** a separate
project run after this one — its steps interleave with the API phases, because the hub already
holds the rates/bookings the go-live plan says to load by hand. **Critical ordering rule
(from the go-live plan): on activation, Booking.com deletes its own prices/availability and
takes whatever is in Beds24 — so Beds24 must be correct *before* you flip the switch.**

| # | Step | Owner | Doc |
|---|---|---|---|
| 1 | T0 — identify the secret (invite-code vs long-life), confirm write scope | CODE | brief |
| 2 | **Priority 1** — create + map all room types in Beds24 ("Get Codes") | Charlie (Beds24 UI) | go-live |
| 3 | Phase 0 — API discovers `beds24PropId`/`beds24RoomId`, sign-off, run migration | CODE | brief |
| 4 | **Priority 2 + 3 via API** — bulk-load current rates, availability, and all non-BDC bookings into Beds24 (see "Initial load" below). Manual entry is the fallback | CODE | brief + go-live |
| 5 | Price Check / Price Data verify; close any dates with Override | Charlie (Beds24 UI) | go-live |
| 6 | **Priority 4** — activate the Booking.com↔Beds24 connection; turn Auto-Replenishment OFF | Charlie (Beds24 UI) | go-live |
| 7 | Phase 1 — inbound pull + webhook (shadow → flip) | CODE | brief |
| 8 | Phase 2 — outbound incremental sync (shadow → flip, **Booking.com-only**) | CODE | brief |

**Scope reconciliation (see go-live notes):** Booking.com only this pass. **Expedia stays on
the current browser path** until it's linked to Beds24 — so Phase 2 / the outbound flip is
BDC-only and must not disable Expedia pushing. Also resolve the **4-properties-vs-5** question
(is **Seamless** being onboarded now?) before Priority 1.

### Initial load (one-time backfill into Beds24, step 4 above)
Powers go-live Priorities 2 & 3 from hub data instead of manual entry. Requires write scope +
the `beds24RoomId` map from Phase 0.
- **Rates:** read `RateOverride` (+ `RoomType.basePrice` fallback) → `POST /inventory/rooms/calendar`
  `price1` per room/date. Same code path as Phase 2's `beds24-push.mjs`; just run it once over the
  full forward date range instead of off the queue. Page and respect the 100-credit/5-min limit.
- **Availability:** compute rooms-to-sell per room/date from `totalUnits − active bookings − Blocks`
  and POST it alongside the price.
- **Non-BDC existing bookings** (direct, phone, Expedia) → `POST /bookings` so Beds24's calendar
  reflects true availability before activation. BDC's own upcoming bookings come in via the
  go-live plan's "Import Existing Bookings" (Step 7) — don't double-load those.
- **Verify** with Beds24 Price Check / Price Data (go-live Priority 2.3 / 4.5) before activating.

## What changes, concretely

| Layer | Today (retire after cutover) | Beds24 replacement (build) |
|---|---|---|
| Auth | n/a | `lib/beds24.ts` — refresh-token → 24h-token cache + auto-refresh |
| ID mapping | `bdcRoomId` / `expediaRoomId` on `RoomType` | add `beds24PropId` (Property) + `beds24RoomId` (RoomType), discovered from `GET /properties` |
| Inbound bookings | `email-watch` (IMAP IDLE) + `booking-emails` poll + `EmailBookingTask` Chrome fetch | `GET /bookings?modifiedFrom=…` poller **+** `/api/beds24/webhook` on Vercel |
| Cancellations | BDC "Cancelled booking!" email → mark + queue restore | Beds24 booking `status` = cancelled in webhook/poll payload |
| Outbound avail/rates | `scripts/sync-inventory.mjs` (Playwright → BDC/Expedia extranets) | `db/beds24-push.mjs` consuming the **same `SyncJob` queue** → `POST /inventory/rooms/calendar` |
| Unchanged | — | TTLock pipeline, Stripe, quote engine, CRM, booking-site, `reservation-import` |

The `SyncJob` queue stays as the outbound contract — we just add a new consumer that posts
to Beds24 instead of driving a browser. That means the rest of the system (rates pull,
inventory queueing on cancellation, the admin UI) needs **no changes**.

---

## ⚠️ Credential check — do this first, it gates everything

Charlie pasted a 172-char Beds24 secret. Two kinds exist and they are **not** interchangeable:

- **Long-life token** → *read-only*. Fine for inbound (read bookings) but **cannot push inventory**.
- **Refresh token** (from an **invite code**) → can read *and* write.

Outbound availability/rates needs **write access**, so we need a refresh token minted from an
invite code that carries write scopes. Required scopes on the invite code:

```
read:bookings
read:bookings-personal      # guest name/email/phone — needed by door codes + CRM later
read:properties
read:inventory
write:inventory             # or all:inventory
```

(`all:inventory` is the shortcut for read+write+delete on inventory.) Leave IP whitelist
**empty** — the poller runs from the Mac (dynamic IP) and the webhook hits Vercel (dynamic).

**T0 — identify the secret.** Try it as an invite code first, then as a long-life token.
Base URL is `https://api.beds24.com/v2` (confirm against the interactive UI at
https://beds24.com/api/v2 if anything 404s). **Never print the token/refreshToken to the
handoff log — redact them.**

```bash
SECRET='<paste the 172-char blob>'
# (a) invite code path
curl -s -X GET 'https://api.beds24.com/v2/authentication/setup' -H "code: $SECRET" \
  -w '\nHTTP %{http_code}\n'
# (b) if (a) is 4xx, treat it as a long-life token and test a read
curl -s -X GET 'https://api.beds24.com/v2/properties' -H "token: $SECRET" \
  -w '\nHTTP %{http_code}\n' | head -c 300
```

- If (a) returns `{token, refreshToken}` → store the **refreshToken** in `.env` as
  `BEDS24_REFRESH_TOKEN` and proceed.
- If only (b) works → it's a read-only long-life token. Phase 1 (inbound) can proceed with
  it, but **stop before Phase 2** and tell Charlie to generate an invite code with the write
  scopes above (Settings → Marketplace → API → Generate invite code).
- Record which path worked in the handoff log (redacted), and the granted scopes.

---

## Phase 0 — auth + ID discovery (read-only, safe)

**Build `lib/beds24.ts`:**
- Reads `BEDS24_REFRESH_TOKEN` (or `BEDS24_LONGLIFE_TOKEN`) from `.env`.
- `getToken()` — caches the 24h token in `Setting` (key `beds24_token`, with expiry) or a
  local file; refreshes via `GET /authentication/token` with header `refreshToken` when
  within ~5 min of expiry. Tokens last 24h; refresh tokens last as long as used within 30 days.
- Generic `beds24(method, path, {query, body})` helper that injects `token`, and on a 401
  refreshes once and retries.
- Respect rate limits (100 credits / 5 min). Log the `x-five-min-limit-remaining` and
  `x-request-cost` response headers; back off if remaining is low.

**T1 — discover the ID map.** `GET /properties?includeAllRooms=true` (and
`includePriceRules=true` to see rate-rule structure). For each Beds24 property and room,
print `propertyId, propertyName, roomId, roomName`. Then **map to our internal IDs** by:
1. Property name → `Property.id` (streatham/tooting/gassiot/valnay/seamless/flat).
2. Room name → `RoomType.id`. **Honour the qualifier trap** documented in
   `ROOMTYPE_MAP_REFERENCE.md` (e.g. Valnay "Business, Double Room, Shared Bathroom" = id 23,
   not 24). Cross-check the count: every real property should map, 29 real room types
   (the leftover "Flat"/"Room 1" may not).

If Beds24 exposes the channel room IDs (it should, since it manages the BDC/Expedia
connections), prefer matching our existing `RoomType.bdcRoomId` against Beds24's stored
Booking.com room id — that's exact and sidesteps name matching. Report whichever key you used.

**Migration `db/migrate-beds24-ids.mjs`** (idempotent, additive — safe on prod):
```sql
ALTER TABLE "Property"  ADD COLUMN "beds24PropId" TEXT;
ALTER TABLE "RoomType"  ADD COLUMN "beds24RoomId" TEXT;
```
Then populate from the verified map above. **Print the full proposed map and get Charlie's
sign-off in the handoff log before writing the UPDATEs** — a wrong room map mis-routes real
bookings and inventory.

---

## Phase 1 — inbound bookings + cancellations (SHADOW)

Goal: every booking Beds24 knows about lands in our `Booking` table the same way an
email-scraped one does — but in shadow mode we **write to a shadow table and diff**, we do
**not** drive door codes or inventory yet.

**Shadow table** (so we can compare without touching live flow):
```sql
CREATE TABLE IF NOT EXISTS "Beds24BookingShadow" (
  "beds24Id" TEXT PRIMARY KEY,
  "propertyId" TEXT, "roomTypeId" INTEGER, "guestName" TEXT,
  "checkIn" TEXT, "checkOut" TEXT, "channel" TEXT, "channelRef" TEXT,
  "status" TEXT, "totalPrice" REAL, "raw" TEXT, "seenAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**`db/beds24-pull.mjs`** — poll `GET /bookings?modifiedFrom=<lastRun-ISO>&includeInvoiceItems=false`
(page if needed). For each Beds24 booking, map fields → our shape:

| Beds24 field (confirm exact names via a sample GET) | → our column |
|---|---|
| `id` | `Beds24BookingShadow.beds24Id` (and later `Booking.notes`/a `beds24Id` col) |
| `propertyId` → internal via `beds24PropId` | `propertyId` |
| `roomId` → internal via `beds24RoomId` | `roomTypeId` (then auto-assign physical room — reuse `ROOM_AUTOASSIGN_BRIEF.md` logic) |
| `firstName`+`lastName` / `guestName` | `guestName` |
| `email`, `phone` (needs `bookings-personal` scope) | `email`, `phone` |
| `arrival`, `departure` | `checkIn`, `checkOut` |
| `numAdult`, `numChild` | `adults`, `children` |
| `price` | `totalPrice` |
| `referer` / `apiSource` / `apiSourceId` | `channel` (map to 'booking.com'/'airbnb'/'expedia'/'direct') |
| channel's own reference (`apiReference` / `referer`) | `channelRef` |
| `status` (`1`=confirmed, `0`/`cancelled` etc — confirm the enum) | `status` ('confirmed'/'cancelled') |

> **Probe before you build the parser:** pull ONE real booking and inspect the actual JSON
> shape and the `status`/`apiSourceId` enums (`apiSourceId` values:
> https://wiki.beds24.com/index.php/API_V2.0_apisourceids). Build the mapping around what you
> observe, not these assumed names.

**`app/api/beds24/webhook/route.ts`** (Vercel) — accept Beds24's booking webhook POST,
auth-guard it (shared secret in the query string or header — set when configuring the webhook
in Beds24: *Settings → Properties → Access → Booking Webhook*), and write to the same shadow
table. The webhook gives instant reaction; the poller is the safety net (mirror of today's
email-watch + 5-min poll design).

**T2 — shadow diff (the gate to cutover).** Run the poller over the last ~14 days and compare
`Beds24BookingShadow` to live `Booking` rows over the same window:
- Every confirmed Beds24 booking has a matching live `Booking` (by `channelRef`/dates/property).
- Cancellations match.
- Room-type mapping is correct on a spot-check of 10 bookings across all 5 properties,
  **especially Valnay Business**.
Report counts: matched / Beds24-only / hub-only / mismatched-room. Investigate any non-zero
Beds24-only or mismatched before flipping.

---

## Phase 2 — outbound availability + rates (SHADOW)  *(requires write scope — see T0)*

Goal: replace the Playwright extranet push. Re-use the existing `SyncJob` queue verbatim —
`{channel, roomTypeId, date, field, value}` where `field` ∈ {`price`,`availability`,`minstay`}.

**`db/beds24-push.mjs`** — read pending `SyncJob` rows, group by property+room+date, and build
`POST /inventory/rooms/calendar` payloads. **Probe the exact calendar field names first** with
a `GET /inventory/rooms/calendar?roomId=<id>&startDate=…&endDate=…` so you map our fields to
Beds24's real ones (the docs show `price1`..`price16`; availability and min-stay field names
must be confirmed from the GET response, do not guess):

| our `SyncJob.field` | → Beds24 calendar field (confirm via GET) |
|---|---|
| `price` | `price1` (the base rate plan; map per-rate-plan later if needed) |
| `availability` | the rooms-to-sell / `numAvail` field |
| `minstay` | the min-stay field |

**Shadow mode:** for the first runs, set `BEDS24_PUSH_DRYRUN=1` — compute and **log the exact
payloads** that *would* be POSTed, and (optionally) `GET` the current Beds24 calendar for those
dates to show the before/after diff. **Do not mark the `SyncJob` rows done in dry-run.** Once
the diff looks right, do a tiny **live** test: push price+availability for **one room, one
far-future date (e.g. 2027-01-15)**, verify via `GET /inventory/rooms/calendar`, then revert it.
Record verbatim payload + response.

Beds24 *is* the channel manager, so one calendar POST propagates to every OTA **that is linked
to Beds24**. This pass that's **Booking.com only** — Expedia is not on Beds24 yet (go-live plan
defers it). So:
- `beds24-push.mjs` consumes only **BDC-channel** `SyncJob` rows. **Leave Expedia-channel rows
  for the existing browser task** until Expedia is linked to Beds24; do not collapse or delete them.
- When Expedia is later added to Beds24, switch its `SyncJob` rows to the Beds24 consumer too and
  retire the Expedia browser push.
Lowest-risk now: leave the queue as-is, have `beds24-push.mjs` filter to BDC and collapse its own
duplicates.

---

## Cutover (only after T2 inbound diff is clean AND Phase 2 live test passed)

Do inbound and outbound as **two separate flips**, not one.

1. **Inbound flip:** point `beds24-pull.mjs` at the real `Booking` table (not shadow), wire it
   into the same insert path the email poller used (auto-assign + TTLock trigger), then disable
   the email jobs:
   ```bash
   launchctl bootout gui/$(id -u)/com.mcconnell.cm.email-watch
   launchctl bootout gui/$(id -u)/com.mcconnell.cm.booking-emails
   ```
   Add `beds24-pull` to `automation/install.sh` (poll every ~3–5 min as the safety net behind
   the webhook). Keep the email jobs' plists for 1 week as rollback, then delete.
2. **Outbound flip:** turn off dry-run, add `beds24-push` to `install.sh` on the same
   `watch_and_poll` trigger `sync-inventory` used (the `.sync-inventory.trigger` sentinel), then
   disable Playwright:
   ```bash
   launchctl bootout gui/$(id -u)/com.mcconnell.cm.sync-inventory
   ```
3. Update `automation/README.md` to describe the Beds24 jobs and delete the retired rows.
4. Leave `reservation-import`, `stripe-sync`, `import-extras`, `db-backup`, `poll-ttlock-arrivals`
   untouched.

**Rollback:** re-`bootstrap` the old plists; they still read the same DB. Keep them parked for a week.

---

## Out of scope this pass (note for later)
- TTLock door-code trigger off Beds24 booking events (currently fed by `reservation_status.csv`;
  after inbound flip it's fed by Beds24-sourced bookings, so the chain still works — but a
  direct Beds24-webhook → door-code path is a future cleanup).
- Stripe deposits via Beds24's Stripe channel (keeping our own Stripe for now).
- Retiring the `EmailBookingTask` Chrome-fetch task and the `bdc/expedia-extranet-recipes`.

## Checklist for CODE
- [ ] T0 credential identified (invite code vs long-life), scopes recorded, `BEDS24_REFRESH_TOKEN` in `.env`
- [ ] `lib/beds24.ts` token manager + rate-limit logging
- [ ] T1 ID map discovered, signed off, `migrate-beds24-ids.mjs` run
- [ ] `beds24-pull.mjs` + `/api/beds24/webhook` writing to shadow table
- [ ] T2 inbound shadow diff clean
- [ ] `beds24-push.mjs` dry-run payloads verified + one live far-future test reverted
- [ ] Inbound flip + email jobs disabled (plists parked)
- [ ] Outbound flip + Playwright disabled (plist parked)
- [ ] README updated
