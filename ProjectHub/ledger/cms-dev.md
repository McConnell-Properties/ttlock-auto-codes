# Ledger — P2 · CMS dev

Cowork agent: **CMS dev** · Project **P2** · branch `cms-dev`
(worktree `../ttlock-cms-dev`). **Append only — you are the only writer.**
Read `../README.md` + `PM-LOG.md` first. Terminal label: `CMS dev · P2`.

Scope (inside `IT/channel-manager/`): everything EXCEPT P1's Beds24 list — all
`app/` pages + `app/api/**` (non-beds24), `lib/data.ts`, `lib/actions.ts`,
`lib/auth.ts`, `lib/db.ts`, `lib/email.ts`, `lib/messaging.ts`, `lib/stripe.ts`,
`lib/availability.ts`, `lib/allocate.ts`, `middleware.ts`,
`db/schema.sql` + `db/migrate-*.mjs` (you own the schema/data model),
`db/import-extras.mjs`, `db/sync-deposits.mjs`, `db/stripe-sync.mjs`.
STOP-and-flag: schema migrations on prod, mass/live Turso writes, secrets/Vercel.

Reference backlog (from June audit — Charlie prioritises in chat):
- Schema drift: regenerate `schema.sql` from live Turso (~40 cols/tables added by migrations).
- `updateBookingDetails` wipes email/phone (set directly, not COALESCE-guarded) — fix.
- Remove the £1 `test` promo from `Setting.pricing` (live DB write = STOP-and-flag; coord w/ P3).
- Deposit release vocab align with booking-site (`held` vs `hold_active`) — P2↔P3 contract.
- Booking-insert TOCTOU race in `/api/bookings` — add a guard/transaction.
- Middleware auth is off until `ADMIN_PASSWORD` set (human/Vercel) — `/api/reservations/export`
  already fail-closed by PM; review other sensitive routes.
- Stale local `dev.db` fallback (`|| 'file:./dev.db'`) across db scripts — make them require DATABASE_URL.
- Backup job snapshots stale local dev.db, not Turso — fix `db/backup.mjs` to dump Turso.

---

## 2026-06-17 · STATUS · setup
agent: P2 CMS dev   branch: cms-dev
Track ready. Awaiting Charlie's first direction in chat. Append a REPORT here when a cycle ships.
<!-- append new entries below -->

## 2026-06-17 · REPORT · multical lane stacking (overbooking visibility)
Shipped on `cms-dev`: overlapping bookings in the same room now **stack onto separate lanes (rows)** instead of colliding on one line, so double-bookings are fully visible.
- Files: `app/multical/multical.tsx` (+69), `app/globals.css` (+2). (`.next/` cache noise ignored.)
- Logic: `assignLanes()` — greedy interval packing. Non-overlapping bookings collapse to lane 0; overlaps add lanes. No-conflict room = 1 row (baseline unchanged); empty room = 0 lanes (safe).
- Conflict signal: red `mc-over` background, guarded with `!!b` so it only fires on cells that hold a booking; guest name shown normally (no ⚠×N spam); `title` tooltip lists ALL same-room bookings via `conflictOcc`.
- Tests: 10/10 PASS — 5 `assignLanes` unit scenarios (incl. greedy packing + back-to-back stays-1-lane), no-conflict page renders 200 unchanged, TS clean, highlight + tooltip guards.
- TO VERIFY (Charlie — I can't run against cloud Turso): open `/multical` on a date range with a REAL double-booking and eyeball that the two bookings stack on separate rows with the red highlight. Unit tests cover the lane math + the no-conflict baseline; the visual-with-live-conflict wasn't rendered.
- Leftovers: none. Pure UI — no schema/data writes, nothing on the STOP list. On `cms-dev`, not merged (Charlie reviews/merges).

## 2026-06-18 · NEEDS-PM · migrate-booking-origin (prod schema write)
`db/migrate-booking-origin.mjs` adds three columns to `Booking`:
- `originPropertyId TEXT`
- `originRoomTypeId INTEGER`
- `originPhysicalRoom TEXT`

Migration is additive + idempotent (checks PRAGMA table_info, skips existing cols). Does NOT re-add `channelDiverged`.
Dry-run output already confirmed — columns to add: all three.

**Awaiting Charlie sign-off before running `--live` on prod.**
Command (once approved):
```
DATABASE_URL=libsql://mcconnell-cm-mcconnell-properties.aws-eu-west-1.turso.io \
DATABASE_AUTH_TOKEN=<token> \
node db/migrate-booking-origin.mjs --live
```

## 2026-06-18 · NEEDS-PM · migrate-extras-capacity (prod schema write)
`db/migrate-extras-capacity.mjs` creates the `ExtraCapacity` table and seeds 3 rows:
- parking = 1, vented-ac = 2, cooking-pack = 5

Idempotent (skips CREATE if table exists; INSERT OR IGNORE for seeds).
**Awaiting Charlie sign-off before running `--live` on prod.**
Command (once approved):
```
DATABASE_URL=libsql://mcconnell-cm-mcconnell-properties.aws-eu-west-1.turso.io \
DATABASE_AUTH_TOKEN=<token> \
node db/migrate-extras-capacity.mjs --live
```

## 2026-06-18 · P3-CONTRACT · GET /api/extras/availability
Portal uses this at payment step to gate extras purchase.
```
GET /api/extras/availability?extra=parking&from=2026-07-01&to=2026-07-05
→ { extra, from, to, capacity, days: [{ date, available }] }
```
`available=0` on any day = extra fully booked for that night. Unpaid quotes excluded.
P3 must call this for the full stay span before charging. Flag to direct-booking-web track.

## 2026-06-18 · REPORT · moved-booking origin display
Shipped on `cms-dev`: when a booking has been moved, its origin is now visible.

- **Migration** (`db/migrate-booking-origin.mjs`): additive, idempotent, dry-run by default. NEEDS-PM (above) before prod run.
- **`lib/data.ts`**: added `originPropertyId/RoomTypeId/PhysicalRoom` to `Booking` type; `moveBooking` captures origin atomically on first move via CASE-guarded UPDATE (never overwrites).
- **`app/multical/multical.tsx`**: origin fields on `B` type; amber "moved" badge + "Origin: {property} · Room {N}" shown in popover when `originPhysicalRoom` is set; `↗` indicator on the bar cell.
- **`app/multical/page.tsx`**: passes three origin fields through the `bookings.map()`.
- **`app/globals.css`**: `.mc-moved` style for the bar indicator.

PASS/FAIL: TypeScript compiles clean (tsc --noEmit). UI changes are purely additive — bookings without an origin are unaffected. Migration is on STOP-list pending PM sign-off; all other files are safe to deploy. Not deployed.
