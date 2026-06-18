# Go-Live Status Report — McConnell CMS cutover

*Companion to `GO_LIVE_PLAN.md`. The plan states the stance and guardrails; this report states where things actually stand today and what the plan doesn't yet cover. Date: 15 Jun 2026.*

## Current position

The strategic decisions are settled and correct: **Turso is the single source of truth, all changes additive, Little Hotelier is retired (CMS-only).** Backups and freshness checks are live, the local launchd jobs are already writing to cloud Turso, and the reservation/auto-assign/deposit/pipeline-retirement briefs are written. The guardrails in `GO_LIVE_PLAN.md` — backup-first, one-booking canary per write path, parallel-run the old pipeline for a full cycle, dedupe before live money/codes — are the right ones and should not be relaxed.

What the plan glosses over is that **readiness is further back than "briefs are ready" implies.** The source of truth is not yet current, two of the briefs are still unbuilt, and the guest-facing booking-site has deployment-blocking local-file dependencies. None of these are reasons to slow the *plan* — they're the specific work that has to close before direct booking can open safely.

## Readiness by workstream

| Workstream | Status | Gating issue |
|---|---|---|
| Turso as SoT + backups/freshness | **Live** | — |
| BDC backlog → Turso reconcile | **In flight** | Backlog scraped to **Sheets only**; the additive `book-cli` inserts into Turso haven't run/verified |
| 21 duplicate `channelRef` groups | **Open** | Charlie clearing in CRM; blocks backfill + live deposits/codes |
| Room auto-assign at ingest | **Not built** | `ROOM_AUTOASSIGN_BRIEF` — needed now LH no longer assigns rooms |
| Backfill physical rooms (NULL rows) | **Not built** | Blocked by auto-assign **and** dupe cleanup |
| BDC email → Turso bridge | **Not built** | New bookings still land in Sheets, not the SoT, without a manual diff |
| Deposit / pre-auth in CMS | **Per brief, unverified live** | Canary one real booking; money guardrails |
| TTLock door codes on Turso | **Per brief, unverified live** | Parallel-run required — bug = locked-out guest |
| Admin deploy (migrations + `vercel --prod`) | **Unconfirmed** | Per `GO_LIVE_BRIEF`; confirm it actually shipped |
| BDC availability push (rooms-to-sell) | **Manual today** | Not automated — overbooking risk once direct is open |
| Booking-site direct channel | **Partly ready** | Core booking OK; portal/check-in/extras/switch read a local file — see Gap 2 |

## What `GO_LIVE_PLAN.md` misses

**1. The source of truth isn't current yet.** The plan reads as if the data is ready, but the post–13 Jun BDC bookings are sitting in the Google Sheets CRM, **not in Turso**. Opening direct booking against a SoT that's missing real reservations is an overbooking risk. Gate: finish the additive reconcile, verify the booking.com count rose by exactly the diff, before anything downstream.

**2. The booking-site will partly break on Vercel — the biggest unflagged technical gap.** The *core* direct path is fine: `lib/cm.ts` fetches availability live from `${CHANNEL_MANAGER_URL}/api/availability` and creates bookings only via the CM API (Turso). **But** the guest portal, check-in, extras pricing, and room-switch read a **hardcoded local SQLite file** (`lib/portal.ts`, `lib/dynamicPricing.ts`, `lib/switchQuote.ts` all open `file:…/channel-manager/db/dev.db`), and `switchQuote` additionally reads the **now-dead `reservation_status.csv`** ("file wins") at a hardcoded Mac path. On Vercel that file doesn't exist and the CSV is stale — so /portal, /checkin, /api/checkin/*, /api/extras, and /search would fail or serve stale data. These must be repointed to Turso / the CM API before the guest-facing site goes live. `DEPLOY.md` hints at this ("booking site reads local pipeline files… keep it local for now"); the go-live plan drops the caveat entirely.

**3. BDC availability cross-push is manual and absent from the go-live order.** Today you update booking.com availability by hand, which is fine while BDC is the only inbound channel. The moment direct bookings exist alongside booking.com, **a direct booking has to decrement BDC rooms-to-sell automatically or you oversell.** The plan's order (auto-assign → ingest → TTLock → deposit → checkin_data) never includes the channel availability push. Either wire `queue-inventory` → the automated extranet push and verify it, or commit to an explicit manual-update SLA — but it must be a named go-live step, not assumed.

**4. The backfill's dependency on dedupe isn't made explicit.** Guardrail 4 dedupes for deposits/codes, but the **room backfill is equally hostage to the 21 duplicates** — a phantom copy makes a room look occupied, so `assignRoom` skips or mis-flags real bookings. Sequence must be stated: dupes cleaned → auto-assign built → backfill `--dry-run` → review → apply.

**5. No rollback procedure or parallel-run reconciliation check.** The plan says "back up first" and "run alongside the old pipeline," but not (a) the actual restore step if a canary fails (restore from the latest `cloud-*.sql`), nor (b) how you *prove* the Turso path and the old pipeline agree during the parallel cycle — e.g. diff the door codes and deposit links each issued for the same bookings. Parallel-run only protects you if you're comparing the two outputs.

**6. No direct-channel readiness checklist.** Beyond availability, opening direct needs: deposit/charge flow proven, confirmation email + door-code delivery to the guest, and a single availability authority (so the site, BDC, and CMS can't each think a room is free). These should be enumerated and ticked before the channel opens.

**7. Minor — `DEPLOY.md` is now stale in two ways.** Its caveats that the `db/*.mjs` scripts "create their client with the URL only" and that `db:backup` "copies the local file" are both already fixed: the scripts pass `authToken`, and `db:backup` produces `cloud-*.sql` dumps from Turso. Worth reconciling so the deploy docs don't send someone down a path that's already handled.

## Recommended consolidated order

1. Finish the BDC reconcile into Turso and verify counts — **SoT current.**
2. Charlie clears the 21 duplicate groups in the CRM.
3. Build + canary room auto-assign (wire into `book-cli` and `createBookingWithSync`).
4. Backfill physical rooms: `--dry-run` → review → apply (only after 2 + 3).
5. TTLock-on-Turso and deposit-in-CMS, each canaried on one real upcoming booking, running **in parallel** with the old pipeline for one full cycle and reconciled against it.
6. Repoint booking-site portal/extras/switch off the local file/CSV to Turso/CM API; confirm the admin deploy; deploy the booking-site.
7. Automate the BDC availability push (or define the manual SLA).
8. Open direct booking. Then retire the legacy pipeline paths (`import-reservation-status.mjs`, the LH-export branch in `poll-booking-emails.mjs`).

## Bottom line

The plan and its guardrails are sound — the gap is execution state, not strategy. Three things must close before direct booking opens: the SoT isn't actually current (reconcile pending), the booking-site's guest portal/extras/switch will break on Vercel against a local file that won't exist there, and the BDC availability cross-push isn't automated. Everything else is sequencing already captured in the briefs.
