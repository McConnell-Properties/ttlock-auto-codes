# Beds24 Migration — Parallel Execution Plan (multiple Claude Codes)

Goal: get **live on Booking.com ↔ Beds24 ASAP** by running the work across several Claude Code
instances at once, without them colliding on git, the shared Turso prod DB, or the single Beds24
account. Read with `BEDS24_MIGRATION_BRIEF.md` (the what) and `BEDS24_GOLIVE_PLAN.md` (the manual UI steps).

---

## What parallelism can and can't compress

The **critical path to go-live** is mostly manual + one heavy load:

```
T0 credential → [Charlie: map rooms in Beds24] → Phase 0 ID map → bulk-load rates+avail+bookings
→ [Charlie: Price Check] → [Charlie: Activate connection + Auto-Replenishment OFF]
```

Activation is a manual Beds24/Booking.com UI step — no number of Claude Codes speeds that up.
What parallelism **does** buy you: the inbound automation and the outbound incremental sync get
built and validated (in shadow / dry-run) *while* the go-live load and manual steps happen, so
the system is fully automated the moment you activate instead of weeks later.

---

## The streams

One **blocking foundation** stream, then three in parallel, plus Charlie's manual track.

```
                       ┌─────────────────────────────────────────────┐
  CC-A  FOUNDATION ───►│  CC-B  Go-live load   (critical path)        │
  (blocks all)         │  CC-C  Inbound (shadow, read-only)           │  ──► merge ──► live
                       │  CC-D  Outbound (dry-run)                    │
                       └─────────────────────────────────────────────┘
  Charlie (manual, Beds24 UI): invite code · room mapping · Price Check · Activate
```

### CC-A — Foundation  *(do this FIRST, alone; everyone branches off it)*
- **Brief steps:** T0 (identify secret / confirm write scope) + Phase 0 (`lib/beds24.ts` token
  manager, ID discovery, `migrate-beds24-ids.mjs`).
- **Also build the shared helper** `buildCalendarPayload()` in `lib/beds24.ts` (maps our
  `{price,availability,minstay}` → Beds24 calendar fields) so CC-B and CC-D both import it and
  don't write competing versions.
- **Owns / creates:** `lib/beds24.ts`, `db/beds24-discover.mjs`, `db/migrate-beds24-ids.mjs`,
  `.env` additions (`BEDS24_REFRESH_TOKEN`/`BEDS24_LONGLIFE_TOKEN`).
- **Gate before others start:** ID map signed off by Charlie + committed to the `beds24` branch.

### CC-B — Go-live load  *(critical path to activation)*
- **Brief step:** "Initial load" — bulk-load `RateOverride`+`basePrice` and computed availability
  via `POST /inventory/rooms/calendar`; load non-BDC bookings via `POST /bookings`.
- **Owns / creates:** `db/beds24-initial-load.mjs`, `db/beds24-load-bookings.mjs`.
- **Imports (read-only) from CC-A:** `lib/beds24.ts` (`buildCalendarPayload`, token helper).
- **Heavy API writer** → holds the rate-limit budget during its run (see Shared resources).
- **Depends on:** CC-A done **and** Charlie's room mapping (Priority 1) done.

### CC-C — Inbound automation (shadow, read-only — safe to run anytime after CC-A)
- **Brief Phase 1:** `beds24-pull.mjs` (poll `GET /bookings?modifiedFrom=`), the Vercel webhook
  route, shadow table, and the T2 diff.
- **Owns / creates:** `db/beds24-pull.mjs`, `app/api/beds24/webhook/route.ts`,
  `db/migrate-beds24-shadow.mjs`, `db/beds24-diff.mjs`.
- **Read-only against Beds24** → low credit cost, won't fight CC-B much.
- **Depends on:** CC-A (ID map).

### CC-D — Outbound incremental sync (dry-run until after activation)
- **Brief Phase 2:** `beds24-push.mjs` consuming **BDC-channel** `SyncJob` rows → calendar POST.
  Keep `BEDS24_PUSH_DRYRUN=1` until Charlie has activated. **Expedia rows stay on the existing
  browser task** — do not touch them.
- **Owns / creates:** `db/beds24-push.mjs`, and (only after dry-run validated) the
  `automation/install.sh` + `automation/README.md` edits for the new launchd jobs.
- **Imports (read-only) from CC-A:** `lib/beds24.ts` (`buildCalendarPayload`).
- **Depends on:** CC-A (ID map); live test needs write scope.

### Charlie — manual track (runs in parallel with all CODE work)
1. T0 result: if the secret is read-only, generate an invite code with
   `read:bookings read:bookings-personal read:properties all:inventory` (Settings → Marketplace → API).
2. **Resolve 4-vs-5 properties** — is **Seamless** onboarding now? (See go-live reconciliation notes.)
3. Priority 1: create + map all room types in Beds24 ("Get Codes").
4. After CC-B's load + Price Check looks right: Priority 4 — Activate connection, turn
   **Auto-Replenishment OFF**, confirm XML Active / Open.

---

## File-ownership matrix (collision avoidance — each file has ONE owner)

| Path | Owner |
|---|---|
| `lib/beds24.ts` | CC-A |
| `db/beds24-discover.mjs`, `db/migrate-beds24-ids.mjs` | CC-A |
| `db/beds24-initial-load.mjs`, `db/beds24-load-bookings.mjs` | CC-B |
| `db/beds24-pull.mjs`, `db/beds24-diff.mjs`, `db/migrate-beds24-shadow.mjs`, `app/api/beds24/webhook/route.ts` | CC-C |
| `db/beds24-push.mjs` | CC-D |
| `automation/install.sh`, `automation/README.md` | CC-D (only, after dry-run) |
| `AGENT_HANDOFF.md` | shared — **append only**, never edit others' text |

Nobody but CC-A edits `lib/beds24.ts`. If CC-B/CC-D need a new helper there, they request it from
CC-A via `AGENT_HANDOFF.md` rather than editing it.

---

## Branch + worktree setup (one-time)

No git remote — everything is local. Use one worktree per parallel stream so the instances never
share a working tree.

```bash
cd ~/ttlock-auto-codes
git stash || git commit -am "WIP before beds24"     # park current uncommitted work
git branch beds24                                    # shared integration branch

# CC-A works in the MAIN checkout on `beds24`. After it commits the foundation:
for s in load inbound outbound; do
  git worktree add ../cm-$s -b beds24-$s beds24
  # share the heavy / gitignored bits so each worktree runs without a 295M reinstall:
  ln -s ~/ttlock-auto-codes/IT/channel-manager/node_modules ../cm-$s/IT/channel-manager/node_modules
  ln -s ~/ttlock-auto-codes/IT/channel-manager/.bdc-profile ../cm-$s/IT/channel-manager/.bdc-profile
  cp    ~/ttlock-auto-codes/IT/channel-manager/.env         ../cm-$s/IT/channel-manager/.env
done
```

- CC-B runs in `../cm-load`, CC-C in `../cm-inbound`, CC-D in `../cm-outbound`; each `cd`s into
  `IT/channel-manager`.
- Merge each branch back into `beds24` (locally) once its shadow/dry-run gate passes; resolve the
  rare conflict in your favour — the ownership matrix keeps overlaps to `AGENT_HANDOFF.md` only.
- `.env` is copied (not symlinked) so an in-flight edit in one worktree can't break another. The
  24h token is cached in the **shared Turso `Setting`** table, so all instances reuse one token.

---

## Shared resources — the three things that bite when running in parallel

1. **Beds24 credit limit = 100 credits / 5 min, per account, shared by all tokens.** Only CC-B
   writes heavily. Rules: every script logs `x-five-min-limit-remaining` / `x-request-cost` and
   backs off when remaining < 20. CC-C/CC-D keep API calls light (CC-C polls modestly; CC-D
   dry-run samples the calendar, doesn't full-scan). **Recommend raising the limit to 200/5 min
   (~€10/mo) for the migration window** — open a Beds24 ticket; it pays for itself in saved wall-clock.
2. **One shared 24h token.** `lib/beds24.ts` caches token+expiry in Turso `Setting` and refreshes
   only within ~5 min of expiry, so the instances don't each mint tokens (wastes credits / races).
3. **Production Turso DB.** Same rule as `AGENT_HANDOFF.md`: no destructive writes. CC-C writes
   only to its `Beds24BookingShadow` table. CC-B writes to **Beds24**, not the hub DB. Migrations
   are additive `ALTER TABLE … ADD COLUMN` only.

---

## Coordination

All instances use `AGENT_HANDOFF.md` as the comms log (append-only, headered messages,
PASS/FAIL/SKIP with verbatim output, end each with a `STATUS:` line). Sequence gates:

- CC-A posts `STATUS: FOUNDATION READY` + the signed-off ID map → the trigger for CC-B/C/D to start.
- CC-B posts `STATUS: BEDS24 LOADED — READY FOR PRICE CHECK` → Charlie's cue to verify + activate.
- CC-C posts its T2 diff; CC-D posts its dry-run payloads. Neither flips to live until Charlie
  confirms activation in the log.

---

## Copy-paste kickoff prompts

Paste one into each Claude Code instance (CC-A first; the rest after CC-A signals ready).

**CC-A (main checkout, branch `beds24`):**
> Read `BEDS24_MIGRATION_BRIEF.md`, `BEDS24_GOLIVE_PLAN.md`, and `BEDS24_PARALLEL_PLAN.md`. You are
> **CC-A (Foundation)**. Do brief steps T0 and Phase 0, and add the shared `buildCalendarPayload()`
> helper to `lib/beds24.ts`. Only touch the files listed under CC-A in the ownership matrix. Never
> print tokens — redact. When the ID map is built, post it to `AGENT_HANDOFF.md` for Charlie's
> sign-off, then `STATUS: FOUNDATION READY`. Do not start any other stream's work.

**CC-B (`../cm-load`, branch `beds24-load`) — start after FOUNDATION READY:**
> Read the three Beds24 docs. You are **CC-B (Go-live load)**. Implement the brief's "Initial load":
> `db/beds24-initial-load.mjs` (rates + computed availability via `POST /inventory/rooms/calendar`,
> importing `buildCalendarPayload` from `lib/beds24.ts`) and `db/beds24-load-bookings.mjs` (non-BDC
> bookings via `POST /bookings`). Respect the 100-credit/5-min limit — log remaining-credits and back
> off. Only touch your files in the ownership matrix. When loaded, post `STATUS: BEDS24 LOADED —
> READY FOR PRICE CHECK`.

**CC-C (`../cm-inbound`, branch `beds24-inbound`) — start after FOUNDATION READY:**
> Read the three Beds24 docs. You are **CC-C (Inbound, shadow)**. Implement brief Phase 1:
> `db/migrate-beds24-shadow.mjs`, `db/beds24-pull.mjs`, `app/api/beds24/webhook/route.ts`, and the
> T2 diff in `db/beds24-diff.mjs`. **Read-only against Beds24; write only to the shadow table.**
> Probe one real booking before building the parser. Post the T2 diff results to `AGENT_HANDOFF.md`.

**CC-D (`../cm-outbound`, branch `beds24-outbound`) — start after FOUNDATION READY:**
> Read the three Beds24 docs. You are **CC-D (Outbound, dry-run)**. Implement brief Phase 2 in
> `db/beds24-push.mjs`, consuming **BDC-channel `SyncJob` rows only** (leave Expedia rows for the
> existing browser task), importing `buildCalendarPayload` from `lib/beds24.ts`. Keep
> `BEDS24_PUSH_DRYRUN=1` — log the payloads you *would* send; do not mark jobs done. Do the
> `automation/install.sh`/`README.md` edits only after the dry-run is validated. Post dry-run
> samples to `AGENT_HANDOFF.md`. Do not flip to live until Charlie confirms activation.
