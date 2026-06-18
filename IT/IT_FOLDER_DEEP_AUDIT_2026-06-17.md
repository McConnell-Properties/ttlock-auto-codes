# IT Folder — Deep Audit

**Date:** 2026-06-17 · **Scope:** every script, doc and config under `IT/` (the two Next.js apps `booking-site` + `channel-manager`, the launchd automation layer, all `db/` scripts, and ~45 markdown briefs). Build artefacts (`node_modules`, `.next`, `.bdc-profile`) excluded. **This is a findings report — nothing was changed.**

---

## 1. Executive summary

The IT folder holds a real, working hospitality stack — a guest-facing **booking-site** and a **channel-manager** ("the hub/CMS") backed by a **Turso cloud database** — that has been rebuilt four times in six days (Jun 11–17). The current direction is sound. The risk is almost entirely *sediment*: retired code and docs from earlier pivots are still sitting alongside the live system, and in several places the old path and the new path both still run, against different data.

The three things that should worry you most, today:

1. **The channel-manager admin UI and every API on it are currently unauthenticated**, running against the live cloud database, because `ADMIN_PASSWORD` is unset in `.env`. One of those open endpoints (`/api/reservations/export`) dumps the entire guest ledger — names, emails, phones, Stripe IDs — and its own header says *"DO NOT deploy until reviewed."*
2. **Live Stripe secret keys and the guest-session signing secret are sitting in `booking-site/.env`, which is not git-ignored.** If that file was ever committed, those keys are compromised and need rotating.
3. **There is a "split-brain" data hazard.** The source of truth moved to Turso ~Jun 13, but the old local `db/dev.db` is *still being written* (modified Jun 16) because ~30 scripts silently fall back to it, and several booking-site features still read it directly. Meanwhile the nightly backup job is backing up that stale local file, not the cloud — **so production Turso currently has no real backup.**

Below: the pivot timeline (so the rest makes sense), a map of what's actually live vs retired, then findings ranked by severity, the doc/workflow contradictions, and a concrete dead-file list.

---

## 2. How the system got here (pivot timeline)

Reconstructed from the briefs and git history. Each era left docs and code behind that the next era contradicts.

| Era | ~Date | What it was | Left behind |
|---|---|---|---|
| **0 — Legacy** | pre-Jun 11 | Little Hotelier + Google Sheets/GAS + `run_reservation_pipeline.py` (room assignment, TTLock codes, £80 deposit, `checkin_data.json`) | Referenced as "the thing being retired" everywhere |
| **1 — Local CMS + browser sync** | Jun 11–12 | channel-manager on local `dev.db`; OTA inventory pushed by driving the Booking.com/Expedia extranets via Claude-in-Chrome | `bdc-extranet-recipes`, `expedia-extranet-recipes`, `booking-com-inventory-automation`, `CALENDAR_SYNC_INSTRUCTIONS`, channel-manager `README` |
| **2 — Turso cloud + Vercel** | ~Jun 13 | DB copied to Turso cloud; `dev.db` frozen and declared stale | `DEPLOY.md`, `GO_LIVE_BRIEF`, Turso briefs |
| **3 — CMS-native pipeline** | Jun 13–15 | Make the CMS itself do room-assign, TTLock, deposits, check-in; retire the Python pipeline | `GO_LIVE_PLAN/STATUS_REPORT`, `PIPELINE_RETIREMENT_BRIEF`, `ROOM_AUTOASSIGN_BRIEF`, check-in specs |
| **4 — Beds24 channel manager (CURRENT)** | Jun 15–17 | Turso stays the hub; **Beds24** becomes the OTA sync layer (all 4 properties live on Booking.com Jun 15, Expedia mapped Jun 16); deposits created by the booking-site portal on a shared Stripe account; sync moving Mac→Vercel cron | `BEDS24_*` briefs, `DIRECT_BOOKING_SPEC`, `deposit-handoff`, `TTLOCK_ISSUER_BRIEF` |

**The current intended system (Jun 17):** Turso hub = source of truth → Beds24 = OTA edge for the 4 live properties (Seamless Stays deliberately held back, still on the old email path) → booking-site portal handles guest check-in + creates the £80 deposit on a shared "deposits" Stripe account → TTLock codes issued from Turso → automation running on the Mac mini, mid-migration to Vercel.

Two consequences of pivoting this fast:
- **Every Era-1 "drive the extranet" doc and every Era-3 "CMS creates the deposit / CMS-native cutover" doc now describes a path that has been superseded.** Following them on a live property would cause real damage (see §5).
- **Code from each era still executes.** The Beds24 webhook, the manual SyncJob queue, and the browser-push task are three different channel mechanisms that all still exist in the repo.

---

## 3. What's actually live vs retired

### channel-manager (the hub)
**Live & healthy:** `/`, `/calendar`, `/multical`, `/crm`, `/tasks`, `/bookings`, `/properties`, `/sync`, and the API contract the booking-site uses (`/api/availability`, `/api/properties`, `/api/bookings`, `/api/bookings/[id]/extras`, `/api/checkin/upsert`). All consistently use `lib/data.ts`.

**Live but dormant / half-built:**
- `/api/stripe/webhook` — returns 503 until `STRIPE_WEBHOOK_SECRET` is set (absent); the polling job `stripe-sync` is the path actually doing the work.
- `/api/beds24/webhook` — wired to the live Booking table but depends on an un-applied ID migration and a manual ID map the migration says *isn't signed off*; almost certainly not yet receiving real traffic.
- `/api/reservations/export` — works, but feeds the **retired** Google-Sheets path and is marked "do not deploy."

**Dead/retired in-app:** `lib/availability.ts` (one-line deprecated re-export, nothing imports it); `lib/beds24.ts`'s API client (only `db/` scripts touch Beds24, not the app); the `emails:poll` npm script (points at `db/poll-booking-emails.mjs`, which doesn't exist).

### booking-site (guest-facing)
**Live:** home/search/book/success, checkout, the `/portal` and `/checkin` flows, extras. **Built but flag-gated off:** the deposit routes (`/api/checkin/deposit`, `/api/webhooks/deposits`) — `DEPOSIT_FROM_CMS` and `STRIPE_SECRET_KEY_DEPOSITS` are empty, so they don't run yet. **Dead:** `/api/checkin/process-due-deposits` (returns-only, no trigger, unauthenticated); `scripts/fix-tunnel.sh` (would drop Gassiot from the tunnel); `lib/discounts.ts → discounted()` (no callers after the double-discount fix).

### automation (launchd, on the Mac mini)
| Job | Status | Schedule |
|---|---|---|
| `stripe-sync` | **Live** | every 5 min |
| `import-extras` | **Live** | every 15 min |
| `poll-ttlock-arrivals` | **Live** | 09:00 & 17:00 only |
| `db-backup` | **Live but broken** — backs up stale local `dev.db` | daily 04:00 |
| `reservation-import` | **Mid-pivot / contradictory** — plist parked Jun 16, yet still in `install.sh` JOBS and its importer was re-edited Jun 16 13:58 *after* parking | watch + 15:40 |
| `beds24-pull` | **Live in production but in no installable plist** — driven by an orphan plist outside the repo; `install.sh` can neither create nor remove it | every ~30 min |
| `ota-sync-queue-push` (browser task) | **Retired/suppressed** — the source of the Jun 15–16 failure storm | (was a Cowork/Chrome task) |

---

## 4. Findings by severity

### 🔴 Critical

**C1 — Channel-manager auth is globally OFF against production data.**
`middleware.ts:12` short-circuits when `ADMIN_PASSWORD` is unset, and it is unset in `.env` (confirmed). With Turso now the live DB, **every admin page and every `/api/*` endpoint is open to anyone who reaches the host.** `SESSION_SECRET` and `CM_API_KEY` are also absent, so even the intended auth couldn't work. → Set `ADMIN_PASSWORD`, `SESSION_SECRET`, and `CM_API_KEY`.

**C2 — Unauthenticated full guest-ledger export.**
`channel-manager/app/api/reservations/export/route.ts` returns every booking with email, phone, Stripe IDs and deposit PIs. Its own header line 4 says *"DO NOT deploy until reviewed."* Protected only by the middleware that is currently disabled (C1). It also exists to feed the retired Sheets pipeline.

**C3 — Live Stripe + portal secrets in a non-git-ignored `.env`.**
`booking-site/.gitignore` does not list `.env`. That file holds live `sk_live_…` keys (Valnay + Gassiot), live `whsec_…` webhook secrets, a Google API key, the `CM_API_KEY` bearer token, and `PORTAL_SECRET` (the HMAC key signing every guest session). → Add `.env` to `.gitignore`, **rotate all of these**, and scrub git history if it was ever committed.

**C4 — `success/page.tsx` verifies Stripe sessions with the wrong key for Gassiot.**
`booking-site/app/success/page.tsx:18` uses the generic `STRIPE_SECRET_KEY`, but the checkout session was *created* with the per-property key (`checkout/route.ts` uses `stripeKeyFor(prop.id)`). For Gassiot, `sessions.retrieve` throws **after a successful live charge** — the guest sees "we couldn't verify your payment" and the booking isn't created on the success path. The webhook backstop is also inert (`STRIPE_WEBHOOK_SECRET` empty). This was supposed to be migrated to `stripeKeyFor` and was missed.

**C5 — Checkout trusts a client-supplied price.**
`booking-site/app/api/checkout/route.ts` charges `Math.round(intent.price * 100)` where `price` comes from a hidden form field / URL query param, never re-validated against the hub's authoritative quote at charge time. A user editing the field controls both what they're charged and the `totalPrice` recorded on the booking. → Re-fetch and assert the price server-side before creating the Stripe session.

**C6 — Production Turso has no backup; the backup job snapshots the wrong (stale) database.**
`channel-manager/db/backup.mjs:8` copies the local `db/dev.db`. The daily 04:00 job is therefore archiving a dead 1.8 MB file (its log shows tiny "1 kept… 4 kept" snapshots) while the cloud source of truth is unprotected. → Replace with a Turso dump (`turso db shell … .dump` / libSQL export).

**C7 — The `|| 'file:./dev.db'` fallback across ~30 db scripts (split-brain).**
Almost every `db/*.mjs` uses `process.env.DATABASE_URL || 'file:./dev.db'`. Any run where `.env` isn't loaded silently reads **and writes** the stale local DB instead of failing. `db/dev.db` was modified Jun 16 — proof scripts are still hitting it. The newer scripts (`poll-ttlock-arrivals.mjs`, the beds24 migrations) correctly *require* `DATABASE_URL` and exit if missing; the rest should match. This is the systemic root of the split-brain hazard.

### 🟠 High

**H1 — £1 promo backdoor still live.** `db/migrate-promos.mjs:34` writes `promoCodes.test = { kind:'set_total', value:1, note:'website testing only — REMOVE before launch' }` into the live `Setting.pricing`. If present in Turso, promo code `test` makes any guest pay **£1**. → Remove before/if the booking-site goes live.

**H2 — Beds24 webhook uses a different ID model than the rest of the app.** `app/api/beds24/webhook/route.ts` maps via `beds24PropId`/`beds24RoomId` (only populated if `migrate-beds24-ids.mjs` ran *and* manual UPDATEs were applied), while the rest of the app keys on `bdcHotelId`/`expediaHotelId`. It also caches the ID map at module load and never invalidates, inserts every booking as `'confirmed'` regardless of real Beds24 status, and skips `queueInventorySync` so OTA inventory drifts after an inbound booking. Resolve before this webhook takes traffic.

**H3 — `beds24Id` column type conflict (confirmed).** `db/migrate-beds24-booking-id.mjs:27` adds it as **INTEGER**; `db/beds24-pull.mjs:41` adds the same column as **TEXT** and writes `String(id)`. Whichever runs first wins; the other silently no-ops. `beds24-sync-bookings.mjs` then treats it as a number. Mixed INT/TEXT storage of the same key can break equality/joins between the two pollers.

**H4 — Expedia native/non-native contradiction between the two Beds24 pollers.** `beds24-pull.mjs:36` treats Expedia as a *native* channel (inbound only); `beds24-sync-bookings.mjs:150` treats it as *non-native* and would push it back out. Risk of echo/double-handling of Expedia bookings. Pick one rule.

**H5 — booking-site reads the stale local DB directly.** `lib/dynamicPricing.ts`, `lib/switchQuote.ts`, and `lib/portal.ts` open `../channel-manager/db/dev.db` directly, bypassing the live cloud hub. So demand pricing, room-switch quotes, and the portal's check-in lookup all see stale data — and will simply break on Vercel where that file doesn't exist. Contradicts `cm.ts`'s "hub is source of truth" design.

**H6 — Deposit status vocabulary mismatch between the two apps.** booking-site writes a live hold as `status:'hold_active'` (`lib/depositRecord.ts`); the CM auto-release job (`db/sync-deposits.mjs`) only matches `depositStatus='held'`. Holds created by the booking-site won't be recognised by the CM's release/refund job. Align the vocabulary before flipping `DEPOSIT_FROM_CMS=1`.

**H7 — Deposits webhook has no try/catch or idempotency on the money path.** `booking-site/app/api/webhooks/deposits/route.ts` calls Stripe `retrieve`/`cancel`/`capture` unwrapped; a Stripe error throws a 500, Stripe retries, and a redelivery re-runs `capture` (which then errors on the already-captured PI), all while the local record never updates and the guest's room stays gated.

**H8 — reservation-import path is genuinely ambiguous.** The plist was parked Jun 16, but the job is still in `install.sh` JOBS and the importer was re-edited *after* parking — so `install.sh` would regenerate the job on next run. Also the WatchPaths plist watches `~/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/…` while the repo actually lives at `~/ttlock-auto-codes/IT/…`, so the event trigger likely never fires and the job only runs at the 15:40 backstop. Decide: keep or kill, then make `install.sh` and the watch path agree.

**H9 — `beds24-pull` is un-reproducible.** It runs every 30 min in production but exists in no plist inside the repo, so `install.sh uninstall` can't remove it and a fresh install can't recreate it. Bring it into `install.sh`.

**H10 — `schema.sql` has drifted ~40 columns / several tables behind the live DB.** All the `Booking.beds24*/stripe*/roomLocked`, the `CrmRecord.deposit*/arrived*` fields, and tables like `EmailBookingTask`, `Beds24BookingShadow` were added by later `migrate-*.mjs`. Anyone running `init.mjs` gets a DB missing half the columns the app needs. → Regenerate `schema.sql` from live Turso.

**H11 — The OTA sync-failure storm is quieted, not fixed.** 24 `sync-failure-*.json` (Jun 15 14:16 → Jun 16 09:56): 20 are "BDC session expired" (extranet logged out, task correctly refuses to log in), the rest "wrote 1, read back 0" (half-authenticated UI never committed). Backdrop: an unreviewed **16,994-job full-year price flood created in one minute on Jun 12 16:44** that all four `ota-push-report` runs deliberately HELD. No success artefact exists and no root-cause fix is recorded — the task was simply parked. Inventory/pricing for that path is not reaching the OTAs. *(Note: this "16,994" figure is in the automation logs, not the briefs — the doc set itself doesn't mention it.)*

### 🟡 Medium (selected — full list in the per-agent notes)

- **`updateBookingDetails` (data.ts) wipes email/phone** — `email = ?`/`phone = ?` set directly (not COALESCE-guarded like the other fields), so a partial update with nulls erases contact info.
- **Stale `booking.com` SyncJobs** queued by `import-rates`/`queue-inventory`/`book-cli` now that Beds24 owns BDC pricing — confirm nothing still drains them as no-op work.
- **Portal login redirect crosses tenants** — `app/api/portal/login/route.ts:6` reads a module-scope `SITE` (Streatham/localhost), so a Gassiot guest is redirected off-domain and drops the cookie.
- **`process-due-deposits` is unauthenticated** when `PROCESS_DEPOSITS_SECRET` is empty (it is) and returns guest PII.
- **Two pricing engines diverge** — hub `totalPrice` (live) vs `dynamicPricing`/`switchQuote`/`discounts` (reading stale data); README still claims the site applies the long-stay discount itself.
- **Booking insert TOCTOU** — `app/api/bookings/route.ts` quotes then inserts with no lock; two simultaneous last-room bookings both succeed.
- **`.data/checkin-contacts.json` holds two incompatible record schemas** — old rows (`arrivalTime`+singular contact) vs new (`contactMethods[]`); old guests render check-in step 3 empty.
- **`migrate-booking-allocation.mjs` does a DROP/recreate of Booking** — guarded by a column check so it no-ops once applied, but the most dangerous migration if ever re-triggered on a partial schema.
- **Door codes for guest emails still come from the retired pipeline file** — `lib/messaging.ts` reads `checkin_data.json` (old automation output) via a hardcoded `/Users/charliemcconnell/…` path, coupling the "new" CMS to the "retired" pipeline.

### 🟢 Low (representative)
Room-name sorts assume numeric IDs (`lib/allocate.ts:22`, `NaN` on "2A"); `set_total` promo can raise a price if misconfigured; several BST/DST countdowns hand-rolled (display-only); `sync-cli.mjs` string-interpolates its channel filter (CLI-only); `today()` is UTC-based across the app (late-evening edge). None are urgent.

---

## 5. Contradictions most likely to cause an operational mistake

Ranked by blast radius:

1. **Extranet browser-push vs Beds24.** `CALENDAR_SYNC_INSTRUCTIONS`, `bdc-extranet-recipes`, `booking-com-inventory-automation`, `expedia-extranet-recipes` and the channel-manager README all describe manually pushing prices/availability through the extranet. For the 4 live properties Beds24 now owns that — and post-activation the Booking.com extranet *refuses* price edits. Following these docs causes rate drift / oversell. **These docs are the single biggest trap.**
2. **Seamless room-ID swap.** `1268631801` and `1268631803` are swapped between `ROOMTYPE_MAP_REFERENCE.md` and the authoritative `roomtypes-bdc-map.csv` (`BEDS24_FIX_BRIEF` confirms the CSV wins). Mis-routes Seamless bookings/inventory at its eventual go-live.
3. **Who creates the £80 deposit + how.** Three docs name three owners (pipeline / CMS / portal) and two mechanisms (always-hold vs hold-for-credit / charge-for-debit). Current truth: **portal creates, on a shared Stripe account, routing by card type**; `deposit-coordination.md` (per-property keys) and `PIPELINE_RETIREMENT_BRIEF` Phase 3 (CMS-creates) are stale.
4. **"4 properties / 20 room types" vs "5 / ~29."** `BEDS24_GOLIVE_PLAN`'s headline numbers omit Seamless; acting on them silently drops Seamless from sync.
5. **Backup target** — `DEPLOY.md`/`automation/README` say back up local `dev.db`; `TURSO_BACKUP_FRESHNESS_BRIEF` says that's the bug (see C6).
6. **Check-in gating & lookup** — older `CHECKIN_WEBSITE_SPEC` gates the *door code* and uses *ref+surname*; the live `checkin-flow-spec` [REV] gates the *room number* and uses *name+dates*. Guest-confusion risk if staff follow the old spec.

---

## 6. Suggested cleanup list (delete / archive)

**Safe to delete (throwaways):**
- `channel-manager/db/_diag.mjs`, `_diag2.mjs`, `_verify_tmp.mjs` — 0 bytes, empty.
- `channel-manager/db/_probe.mjs` — hardcoded path to a *different* session (`/sessions/confident-magical-hopper/…`), no auth, broken.
- `channel-manager/db/_bdc-baseline.mjs` — one-off read-only baseline, served its purpose.
- `channel-manager/dev.db` (root, 0 bytes) and the stale `channel-manager/db/dev.db` once scripts are forced onto Turso.
- `booking-site/scripts/fix-tunnel.sh` — would drop Gassiot from the tunnel; superseded by `deploy/config.yml`.
- `booking-site/public/checkin/front-door-lock.jpg` — retired asset, no longer rendered.

**Archive (one-shot migrations/loaders already applied — move out of the active dir so they can't be re-run by accident):**
- `db/beds24-initial-load.mjs`, `db/beds24-load-bookings.mjs` — one-shot loaders, superseded by `beds24-sync-bookings.mjs`; re-running risks duplicate/overwritten Beds24 data.
- `db/import-reservations.mjs` — superseded by `import-reservation-status.mjs`.
- All applied `db/migrate-*.mjs` (≈12), `db/update-bdc-ids.mjs`, `db/update-expedia-ids.mjs`.
- `db/turso-import.sql` / `db/turso-import.json` — migration-day dumps.

**Stale docs to archive or stamp "SUPERSEDED" so they stop misleading:** `CALENDAR_SYNC_INSTRUCTIONS`, `bdc-extranet-recipes`, `booking-com-inventory-automation`, `expedia-extranet-recipes`, `CLAUDE_CODE_BRIEF_sync-split-and-calendar-nav`, channel-manager `README`, `automation/README`, `RESERVATION_SYNC_WORKFLOW_BRIEF`, `GO_LIVE_PLAN/BRIEF/STATUS_REPORT`, `deposit-coordination`, `CHECKIN_WEBSITE_SPEC`, `room-type-mapping` (Tooting/Seamless rows), `ROOMTYPE_MAP_REFERENCE` (Seamless rows), `DEPLOY.md`, `MISSING_RESERVATIONS_REPORT`, `VERIFY_BOOKING_INGEST_BRIEF`.

---

## 7. Recommended order of attack

1. Set `ADMIN_PASSWORD` / `SESSION_SECRET` / `CM_API_KEY` (C1), and gate or delete `/api/reservations/export` (C2).
2. `.gitignore` the booking-site `.env`, rotate all leaked keys (C3).
3. Fix `success/page.tsx` → `stripeKeyFor(prop.id)` and re-validate price server-side in checkout (C4, C5) — these are live-money bugs.
4. Point `backup.mjs` at Turso; verify a real cloud dump exists (C6).
5. Remove the `|| 'file:./dev.db'` fallback everywhere; delete the stale local DBs (C7).
6. Remove the `test` £1 promo (H1).
7. Reconcile the Beds24 layer before its webhook/outbound goes live: ID model (H2), `beds24Id` type (H3), Expedia native rule (H4).
8. Repoint booking-site `dynamicPricing`/`switchQuote`/`portal` to the hub API and align deposit status strings (H5, H6) before the guest site / deposits launch.
9. Tidy automation: decide reservation-import's fate + fix the watch path (H8), bring `beds24-pull` into `install.sh` (H9), regenerate `schema.sql` (H10), and either re-login to BDC or formally retire the push task + investigate the 16,994-job flood (H11).
10. Archive the dead files and stamp the superseded docs (§6).

*Every code-level claim above was traced to a specific file and line; the highest-stakes ones (auth, the promo backdoor, the stale-DB writes, the `beds24Id` type clash, the parked-vs-live importer) were re-verified directly against the files.*
