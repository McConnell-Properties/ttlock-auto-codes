# OTA Sync Queue — Run Report (2026-06-13)

STATUS: HALTED — no changes pushed. Manual action needed.

## Why no push happened
1. **Booking.com extranet is logged out.** The group homepage loaded from a cached
   session, but any property-level page redirects to the username/password sign-in.
   Per the task's safety rule, I do NOT enter credentials. 49 booking.com inventory
   jobs cannot be applied until someone re-logs in.
2. **Anomalous price flood in the queue.** The queue holds **10,262 price ranges**
   (~16,994 underlying jobs) spanning **2026-05-19 → 2027-05-19**, every property,
   every room, both channels (5,131 booking.com / 5,131 expedia). This is a full-year,
   whole-portfolio rate dump, NOT an incremental sync — it looks like the upstream
   channel-manager re-queued the entire rate table. I did NOT push these; a bulk
   overwrite of a year of live pricing should be reviewed by a human first.
3. **Write-path fragility.** Expedia's Rates & Availability grid did not register a
   scripted value change as "dirty," so an automated Save would not reliably commit.
   Reliable writes would need real keystroke entry per cell — too risky to run
   unsupervised, especially with the channel half-blocked.

## What IS pending (verified, looks legitimate)
- **86 inventory jobs**, bounded 2026-06-09 → 2026-07-10, sane values (0/1/2),
  contiguous recent IDs (27998–28207) — genuine post-booking/cancellation deltas.
  - booking.com: Gassiot 4, Seamless 18, Streatham 23, Valnay 4 (49 total) — BLOCKED (logged out)
  - expedia: Gassiot 4, Streatham 22, Tooting 7, Valnay 4 (37 total) — session live, ready to push
- Expedia session confirmed live; cells are precisely targetable
  (id `inventory_<roomTypeId>_<date>`).

## Email tasks (EmailBookingTask) — also need review
- Several `needs_review` cancellation emails with **no matching confirmed booking**
  and **null extranetUrl** (e.g. refs 6145497074, 5358762348, 6219725679).
- `new` booking tasks also have null extranetUrl, so they cannot be auto-opened/recorded.

## Actions for Charlie
1. Re-login to admin.booking.com in the browser profile.
2. Investigate the 10,262-range price flood at the channel-manager source before any price push.
3. Confirm whether to proceed with the 86 inventory jobs; then re-run this task to push both channels consistently.

## What this run did NOT do
- No extranet changes (one Expedia test edit was reverted/unsaved).
- No queue jobs marked done/failed (left pending for retry).
- No credentials entered. No price push. Change-gate stamp NOT written (so next run re-evaluates).

---

## Re-run confirmation — 2026-06-13 (later run)

A second scheduled run re-checked the queue and reached the same HALT decision. Nothing has changed since the 11:44 run (stamp still unwritten, situation unresolved). Verified again:
- Sync queue: **86 inventory jobs** (23 past-dated, 63 current/future) + **10,262 price ranges** = 16,994 underlying job IDs, spanning 2026-05-19 → 2027-05-19, mirrored booking.com/expedia. 364 price ranges fully in the past.
- Email tasks: **88 pending** (69 new, 8 modified, 11 needs_review), all booking.com — **every one has `extranetUrl: null` and `propertyName: null`**, so the record-booking step has no page to open and cannot run as written.
- Did not open the extranets this run (prior run already established Booking.com is logged out → blocked by safety rule; Expedia write path unreliable). No changes pushed, no jobs marked, stamp not written.

The three blockers from Charlie's action list remain outstanding: (1) re-login to admin.booking.com, (2) investigate the full-year price flood at the source, (3) confirm the 86 inventory jobs before re-running.
