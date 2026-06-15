# Test Plan — sync-inventory.mjs (run before trusting it live)

**For:** Claude Code on the Mac, in `channel-manager`.
**Goal:** Prove the script is safe and correct *before* the launchd trigger is allowed to drive all five properties. Do not skip to a full live run.

Work top to bottom. Stop and report if any step fails.

---

## 0. Add a dry-run mode (if not already present)

Add `SYNC_INVENTORY_DRYRUN=1`: pulls the queue, computes every intended write, logs `property / room / date / current → target`, but commits **nothing** to the extranet and does **not** call `sync-cli done/failed`. Every test below that says "dry-run" relies on this.

---

## 1. Guardrails (static / dry-run — no extranet writes)

1. **Price exclusion.** Confirm `--type inventory` filters server-side. Then seed a fake price/rate job in the queue and run dry-run — assert the script refuses it (never emits a write for any field that isn't `rooms-to-sell`). This is the one that's expensive to get wrong; test it explicitly.
2. **Date boundary.** Seed three jobs: date < today, date == today, date > today. Dry-run must classify only `> today` as editable; `today` and past must be marked done-unpushed, never pushed.
3. **Queue marking location.** Confirm `sync-cli done/failed` only ever runs in the Mac process, never a sandboxed path.

## 2. Concurrency / lock

1. **Serialize.** Start a run, then fire a second while it's active — second must exit immediately (no second browser session on the same `ses`).
2. **Stale lock.** Kill a run mid-flight (or write a lock referencing a dead PID), then start again — it must detect the stale lock and proceed, not wedge. If the lock has no PID/mtime staleness check, add one.

## 3. Trigger wiring

1. **Sentinel fires.** Run `queue-inventory.mjs`, confirm it touches `automation/logs/.sync-inventory.trigger` and that the launchd `WatchPaths` job fires.
2. **Debounce.** Confirm `ThrottleInterval` is seconds (not minutes) and that a burst of enqueues coalesces into a single run, not one per job.
3. **Backstop.** Confirm the 6:00 AM daily run is registered and independent of the watch trigger.

## 4. Escalation path

Force each failure type and confirm clean handling — job marked `failed`, structured `.json` log written, screenshot saved, desktop + email notification sent, process exits cleanly with no partial extranet write:
- Selector not found (rename a selector temporarily).
- `totalPlaceholders=0` after retries (point at an empty/blocked window).
- Expired `ses` / logged-out session.

## 5. Staged live run (smallest blast radius first)

Only after 1–4 pass:

1. **One property, dry-run vs reality.** Pick the lowest-volume property. Dry-run, eyeball the intended writes, then run live for that property only.
2. **Verify by hand.** Open the BDC extranet, spot-check 2–3 of the cells it claims it set; confirm the queue shows those ids `done`.
3. **Idempotency.** Re-run immediately — it should be a no-op (queue already `done`), no duplicate writes.
4. **Then widen** to all five properties via the normal trigger, and watch the first automatic (enqueue-driven) run end to end.

---

## Report back

For each section: pass/fail, and for any failure the job id, failing step, and log/screenshot path. Don't enable the all-properties trigger until 1–4 are green and the single-property live run in 5 verified clean.
