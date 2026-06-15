# OTA Sync Queue — Run Report (HELD, no extranet changes)

**Run:** 2026-06-13 (fourth scheduled `ota-sync-queue-push` of the day, autonomous)
**Outcome:** No changes pushed. Same anomaly as the 10:39 / 10:52 / 11:09 runs — still unresolved. Held again.
**Stamp written:** No (so the next run keeps re-evaluating instead of skipping).
**Jobs marked done/failed:** None. **Email tasks marked done:** None.

## Change gate (Step 0)
Stamp file `.ota-push.last` is still absent, so the run proceeded to full evaluation. Re-verified directly against the DB — nothing has changed since the prior three holds today.

## Independently re-verified facts
**Sync queue — full-year bulk seed, unchanged:**
- `sync-cli list` summary: **86 inventory jobs, 10,262 price ranges**.
- Raw pending SyncJobs: **86 inventory + 16,994 price = 17,080**. Lifetime done/failed: **0** — nothing has ever been closed.
- **All 16,994 price jobs were created in one minute: `2026-06-12 16:44`.** Range **2026-05-19 → 2027-05-19**, only **30 distinct price values**. This is a complete rate-calendar re-export, not booking-driven deltas. Hand-keying ~17k price points through the extranet UIs is infeasible in a scheduled run and would risk overwriting a year of correct live prices across all four properties if the seed is stale.
- Inventory pending range: **2026-06-09 → 2026-07-10** (looks individually sane, but derives from a DB that does not yet reflect the unprocessed email bookings — see below).

**Email booking queue — unchanged, still not actionable:**
- **88 pending, all `status='pending'`.**
- **Every task still has `extranetUrl: null` AND `propertyId: null`** (88/88). Step 5 requires both to record a booking, so none can be processed without guessing.

## What I did NOT touch
Did not open Chrome / did not log into any extranet. Did not change availability, price, payouts, account settings, or guest messaging. Did not mark any sync job done/failed. Did not mark any email task done. Did not write the run stamp.

## Needed from a human (unchanged across all four runs today)
1. Confirm whether the **2026-06-12 16:44** bulk price seed (16,994 jobs) is intended. If yes, push via the bulk/API path — not the extranet UI. If not, clear/dedupe the price queue.
2. Fix the detail-fetch step so `EmailBookingTask` rows get `extranetUrl` + property/room mapping; then the 69 new / 8 modified can be recorded and the needs_review items triaged.
3. Once the booking DB reflects current bookings, re-run so inventory jobs push from accurate state.

## Sandbox notes
- `@libsql/linux-arm64-gnu` is still missing from `node_modules` (only `darwin-arm64` present) and had to be reinstalled to run the CLIs in this Linux sandbox — worth pinning a cross-platform install or committing the optional dep.
- Left an empty (0-byte) temp file `db/_verify_tmp.mjs` — the sandbox mount blocked unlink (`Operation not permitted`), so it could only be truncated, not deleted. Safe to `rm` manually.
