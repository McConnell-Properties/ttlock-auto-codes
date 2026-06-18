# GO LIVE — reservation system cutover (live, not test)

**Charlie's call: go live immediately.** All the reservation briefs are now **LIVE** — live Stripe key, real Turso, real TTLock (real door codes). This note is the authoritative go-live stance + guardrails and **supersedes the per-brief "test mode only" cautions** (use test mode only for a quick smoke-test if you want, then live).

**Briefs in scope:** `ROOM_AUTOASSIGN_BRIEF`, `BDC_EMAIL_TO_TURSO_BRIEF`, `DEPOSIT_PREAUTH_BRIEF` (CMS creates + manages), `PIPELINE_RETIREMENT_BRIEF` (TTLock-on-Turso + publish `checkin_data.json`). `TURSO_BACKUP_FRESHNESS` is already live.

## Order
auto-assign → email→Turso ingest → TTLock-on-Turso → deposit creation in CMS → publish `checkin_data.json` → **verify one full cycle** → retire legacy.

## Non-negotiable guardrails (these protect real guests + real money)
1. **Backup first.** Confirm a fresh `cloud-*.sql` backup exists before any live write.
2. **One-booking canary per write path.** Prove room-assign, door-code, and deposit-link each on a *single real upcoming booking* before enabling for all. A door-code bug locks guests out; a deposit bug double-holds a card.
3. **Run alongside the old pipeline for one full cycle — do NOT delete it yet.** `run_reservation_pipeline.py` / `pipeline-watch` / `reservation-import` are *currently issuing your real door codes and deposits*. A hard cutover with a bug = locked-out guests + no deposits. Disable them only after the Turso path has created **and** deleted codes and created a deposit link correctly.
4. **Dedupe before live deposits/codes.** The 21 duplicate `channelRef` groups are a live hazard — without a guard, a guest could get two £80 holds or conflicting door codes. Either clean the dupes first, or make the deposit + TTLock jobs dedupe strictly by `channelRef` (one hold, one code per ref).
5. **Money rules (confirmed):** capture is a staff action only; auto-release is a cancel (no charge); no MOTO/staff card entry — any amount owed → portal payment link.

**Stop and report if any canary fails.** Live means a bug has real consequences at the front door and on a guest's card — speed is fine, skipping the canary + parallel-run is not.
