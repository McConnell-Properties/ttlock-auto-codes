# Claude Code Brief — Split pricing/inventory sync + Multicalendar nav

**Repo:** `channel-manager` (the CMS — Next.js/TypeScript, sync queue in `db/`).
**Run from:** the Mac (has the repo, network access, and DB env). The Cowork sandbox cannot reach the DB.
**Two independent changes below.** Do them as separate commits/PRs.

---

## Change 1 — Split pricing sync from inventory sync in the CMS

### Problem
`node db/sync-cli.mjs list booking.com` currently returns **both** `inventoryJobs` (~49) **and** `priceRanges` (~5,131) in one payload. The price ranges dominate the output (~2–3 MB JSON), so any inventory-only consumer (the overnight BDC inventory push) ingests ~500k tokens of price data it never uses. Inventory and pricing also have different downstream targets and cadences and should be operable independently.

### Goal
Make inventory and pricing **separately listable, markable, and pushable** — without changing what data is stored.

### Requirements
1. Add a `--type` filter (or subcommands) to `sync-cli`:
   - `list <channel> --type inventory` → returns **only** `inventoryJobs`. Must NOT include `priceRanges`.
   - `list <channel> --type pricing` → returns **only** `priceRanges`.
   - Bare `list <channel>` → keep backward-compatible, but change the default to emit **counts/summary** (e.g. `{inventoryJobs: 49, priceRanges: 5131}`) rather than dumping all price ranges, so nothing accidentally pulls the full price blob. (If full-both output must stay for compatibility, gate it behind an explicit `--type all` and document it.)
2. `done <ids>` and `failed <id> "note"` must continue to work for any job regardless of type (IDs are globally unique — confirm this in the schema; if inventory and price IDs can collide, namespace them).
3. If the queue isn't already tagged by job type, add a `type` column (`inventory` | `pricing`) and backfill, OR filter by the existing distinction (inventoryJobs vs priceRanges tables/collections). Prefer a single source of truth with a discriminating field.
4. Update every existing consumer to use the inventory-only variant where appropriate — in particular the BDC inventory push flow and any scheduled task that calls `list booking.com`. **Inventory push must never touch prices.**
5. Update `db/`/CLI help text and any README so the split is documented.

### Acceptance criteria
- `node db/sync-cli.mjs list booking.com --type inventory` returns only inventory jobs; output is small (no price ranges present).
- `node db/sync-cli.mjs list booking.com --type pricing` returns only price ranges.
- `done` / `failed` still work and are idempotent.
- Existing inventory push runs on the inventory-only list.

### While you're in there — verify the DB target (important)
The overnight run reported `sync-cli` writing to a **local `db/dev.db`** (it left a `dev.db-journal`), while `.env` `DATABASE_URL` points at the **Turso cloud DB** (`libsql://…`). Confirm `sync-cli` actually loads `.env` and uses the Turso client, not a local SQLite fallback. If it's falling back to `dev.db`, the CLI/queue and the deployed site may be on **different databases** — fix so `sync-cli` and the app share one source of truth. Do not do destructive writes on production data while testing.

---

## Change 2 — Multicalendar date navigation (CMS view)

### Goal
On the channel-manager **CMS multicalendar** view, add navigation controls so the user can view more dates beyond the current window.

### Requirements
- Add two nav buttons on the multicalendar:
  - **Back** button → shifts the visible date window **back by 1 week (−7 days)**.
  - **Forward** button → shifts the visible date window **forward by 3 days (+3 days)**.
  - (Asymmetric step sizes are intentional per request: back 7 / forward 3. Flag if you think symmetric is better, but implement as specified by default.)
- After navigating, fetch/refresh inventory + rate data for the newly visible dates so cells aren't blank.
- Preserve current room/property selection and scroll position across navigation where reasonable.
- Don't allow navigating into ranges with no data if the backend errors on it — clamp gracefully.

### Acceptance criteria
- Clicking **Back** moves the visible window 7 days earlier and loads that data.
- Clicking **Forward** moves the visible window 3 days later and loads that data.
- No regressions to the existing default view.

---

## Guardrails (both changes)
- Inventory only for the push path — never write prices to channels.
- No destructive writes against production data; test against a safe DB/branch.
- Keep Stripe in test mode for any related testing; TTLock read-only.
- Open as reviewable commits with clear messages.
