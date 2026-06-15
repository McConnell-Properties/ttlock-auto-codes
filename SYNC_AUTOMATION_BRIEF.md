# Implementation Brief — Codify Calendar Sync (zero-credit, event-driven)

**For:** Claude Code, running on the Mac inside the `channel-manager` repo.
**Goal:** Replace the LLM-driven browser sync with a deterministic Node + Playwright script that runs in seconds at zero Claude-credit cost, fires automatically the moment a job is enqueued, and escalates to Claude only when it genuinely breaks.

Read `CALENDAR_SYNC_INSTRUCTIONS.md` and `bdc-extranet-recipes.md` first — they are the source of truth for the procedure, selectors, and the `setRoomInventory` helper. This brief tells you what to build, not how the extranet behaves.

---

## Hard guardrails (do not violate)

- **Inventory only.** Push `rooms-to-sell`. Never touch prices/rates.
- **Never edit dates ≤ today.** BDC blocks them; mark those jobs done-unpushed.
- **Only DB writes allowed are `sync-cli done` / `failed`** (idempotent). No other writes.
- **Queue marking must run on the Mac**, never the sandbox (sandbox gets `SQLITE_IOERR_DELETE`). The script runs on the Mac, so this is satisfied — just don't move the marking step into any sandboxed context.

---

## Part 1 — The sync script (deterministic, no LLM)

Create `scripts/sync-inventory.mjs` (Node + Playwright). It must reproduce the runbook end to end:

1. **Pull the queue:** `node db/sync-cli.mjs list booking.com --type inventory`. Parse each job's id, property, room id, date, target `rooms-to-sell`. Split into **editable** (date ≥ today) and **past-dated** (date ≤ today).
2. **Reuse the existing `ses` cookie / browser profile** — do not implement login. Load the persisted profile so the session token is already present. Switch property by `hotel_id` (table below).
3. **Open the calendar** in LIST view scoped to the date window:
   `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id={HOTEL_ID}&lang=en&ses={SES}&view_mode=LIST&from=YYYY-MM-DD&until=YYYY-MM-DD`
4. **Force the full render (Step 3 of the runbook), as code:** wait/poll until `totalPlaceholders > 0`; click the date-range field to open the picker, press **Escape twice** to close (first press often no-ops) to trigger re-render; push only viewport rooms, **never scroll mid-batch** (scrolling un-renders) — repeat the nudge per viewport batch.
5. **Set cells** via the `setRoomInventory` helper from the recipe. After each edit **re-read the placeholder** to confirm the value — treat the re-read as source of truth, not the immediate `{"after":null}`.
6. **Verify:** confirm every editable cell reads its target; spot-check one cell per property after a fresh reload.
7. **Mark the queue (on the Mac):** `sync-cli done` for pushed + already-at-target + past-dated; `sync-cli failed <id> "reason"` for genuine failures.

**Hotel IDs**

| Property | hotel_id |
|---|---|
| Streatham Rooms | 14715886 |
| Gassiot House | 15676333 |
| Tooting Stays | 13576893 |
| Valnay Stays | 15779662 |
| Seamless Stays | 12686318 |

**Cost note:** confirm the `--type inventory` flag is wired (avoids pulling ~5,000 price ranges). If absent, finish the sync-split work or filter the price section out — never push price jobs.

---

## Part 2 — Event-driven trigger (not a timer)

Fire `sync-inventory.mjs` the moment a job lands in the queue, so latency is ~seconds and it never runs on an empty queue.

Pick the lightest mechanism that fits the queue's storage (you decide after inspecting it):

- **DB hook / trigger** at the enqueue point in `channel-manager` — preferred if you control that code path.
- **File-watch** (e.g. `chokidar`) on the queue DB / WAL file if enqueue happens out of process.
- **Local webhook** the enqueuer POSTs to, if jobs arrive over the network.

Requirements: debounce so a burst of enqueues coalesces into one run; serialize runs (no overlapping browser sessions sharing one `ses`); idempotent (a re-fire after `done` is a no-op, which it already is).

---

## Part 3 — Escalate to Claude only on exceptions

The routine path must never invoke an LLM. On a failure the script can't resolve deterministically — selector not found, BDC layout shift, `totalPlaceholders=0` after retries, ambiguous/unmappable job, login/`ses` expired — do **not** retry blindly:

1. Mark the affected job(s) `sync-cli failed <id> "<reason>"`.
2. Write a structured log entry (timestamp, property, job id, failing step, the selector/error, a screenshot path).
3. Notify (the channel you already use — email/desktop) with a one-line summary + log path.

Claude is then invoked **manually or by that notification** to diagnose the broken run. Credits are spent only on the rare exception, never the happy path.

---

## Acceptance criteria

- A run with editable jobs pushes them and marks `done`; a run with an empty queue does nothing and costs nothing.
- Past-dated jobs are marked done-unpushed, never edited.
- No price/rate field is ever written.
- The trigger fires within seconds of enqueue, debounced and serialized.
- A simulated selector break marks the job `failed`, logs with a screenshot, notifies, and exits cleanly — no partial/destructive writes.
- Queue marking runs on the Mac.

---

## Open decision for the user

The trigger mechanism in Part 2 depends on how jobs reach the queue today (in-process enqueue → DB hook; out-of-process → file-watch; network → webhook). Inspect `channel-manager`'s enqueue path and choose the lightest fit; if it's unclear, default to file-watch on the queue DB and flag it.
