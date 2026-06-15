# OTA Sync Queue — Run Report (HELD, no extranet changes)

**Run:** 2026-06-13 (third scheduled `ota-sync-queue-push` of the day, autonomous)
**Outcome:** No changes pushed. Same anomaly as the 10:39 and 10:52 runs — still unresolved. Held again.
**Stamp written:** No (so the next run keeps re-evaluating instead of skipping).
**Jobs marked done/failed:** None. **Email tasks marked done:** None.

## Decision
Independently re-verified the queue from the database and reached the same conclusion as the two earlier reports today: this is not a normal incremental delta set, so pushing it to the live extranets would be infeasible and unsafe. Held for human review.

## What the data shows now
**1. Price queue is a full-year bulk seed — confirmed at the row level.**
- `sync-cli list` summary: **86 inventory jobs, 10,262 price ranges**.
- Underlying pending SyncJobs: **86 inventory + 16,994 price = 17,080**, and **every one is still `status='pending'` — nothing in the table has ever been marked done.**
- **All 16,994 price jobs were created in a single minute: `2026-06-12 16:44`.** That one bulk event is the entire price queue. Range spans **2026-05-19 → 2027-05-19**, mirrored evenly **5,131 booking.com / 5,131 expedia**, only ~30 distinct price values (£45–£140). This is a complete rate-calendar re-export, not booking-driven deltas. Hand-keying ~17k price points through the extranet UIs is not possible in a scheduled run, and would risk overwriting correct live prices across all four properties for a year if the seed is stale.

**2. Email booking queue: 88 pending, none actionable as specified.**
- 69 new, 8 modified, 11 needs_review.
- **Every task still has `extranetUrl: null` and `propertyId: null`** — the detail-fetch step that should populate the stay URL and room mapping has not run. Step 5 needs both, so none can be recorded without guessing.
- The needs_review items are cancellation emails with no matching confirmed booking — explicitly for a human.

**3. Booking DB still mid-flux.** The 86 inventory jobs look individually sane (near-term 2026-06-09 → 2026-07-10, values 0/1/2, mirrored across channels), but they derive from a DB that does not yet reflect the 77 unprocessed new/modified bookings sitting in the email queue. Pushing availability from an incomplete DB could cause the very double-bookings this queue exists to prevent — so the inventory jobs were not pushed either.

## What I did NOT touch
Did not open Chrome / did not log into any extranet. Did not change availability, price, payouts, account, or guest messaging. Did not mark any sync job done/failed. Did not mark any email task done. Did not write the run stamp.

## Needed from a human (unchanged from earlier runs)
1. Confirm whether the **2026-06-12 16:44** bulk price seed (16,994 jobs) is intended. If yes, push via the bulk/API path — not the extranet UI. If not, clear/dedupe the price queue.
2. Fix the detail-fetch step so `EmailBookingTask` rows get `extranetUrl` + property/room mapping; then the 69 new / 8 modified can be recorded and the 11 needs_review triaged.
3. Once the booking DB reflects current bookings, re-run so inventory jobs push from accurate state.
4. Note: `@libsql/linux-arm64-gnu` is still missing from `node_modules` and had to be reinstalled to run the CLIs in this sandbox — worth pinning.
