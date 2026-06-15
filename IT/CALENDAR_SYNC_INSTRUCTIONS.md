# Calendar Sync — Operating Instructions

How to sync the calendar (room inventory / rooms-to-sell) from the channel-manager queue to the Booking.com extranet. **Inventory only — never push prices through this procedure.**

> DOM-level helpers and selectors live in `bdc-extranet-recipes.md`. This file is the step-by-step runbook.

---

## Scope & guardrails
- **Inventory only.** Push `rooms-to-sell`. Do not edit prices/rates.
- **Never edit past dates.** BDC blocks dates on or before today; mark those jobs done-unpushed.
- **No destructive DB writes.** `sync-cli` `done`/`failed` are the only writes; they're idempotent.
- **Marking the queue must run on the Mac**, not the Cowork sandbox (sandbox can read the DB but can't write it — `SQLITE_IOERR_DELETE`).

---

## Prerequisites
- Run from the Mac (network + DB access). `channel-manager` repo present.
- Logged into the BDC extranet (`admin.booking.com`) — one `ses` token covers all properties in the group; switch property by changing `hotel_id`.
- Hotel IDs:
  | Property | hotel_id |
  |---|---|
  | Streatham Rooms | 14715886 |
  | Gassiot House | 15676333 |
  | Tooting Stays | 13576893 |
  | Valnay Stays | 15779662 |
  | Seamless Stays | 12686318 |

---

## Step 1 — Pull the inventory queue
```
cd "/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/channel-manager"
node db/sync-cli.mjs list booking.com --type inventory
```
- Use `--type inventory` so the pull excludes the ~5,000 price ranges (keeps the payload small/fast). If that flag isn't available yet, it's pending in the sync-split brief; until then `list booking.com` returns both and you ignore the price section.
- Note each job's: id, property, room id, date, target rooms-to-sell value.
- Separate jobs into **editable** (date ≥ today) and **past-dated** (date ≤ today).

## Step 2 — Open the calendar (per property)
List view, scoped to the date window you're pushing:
```
https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id={HOTEL_ID}&lang=en&ses={SES}&view_mode=LIST&from=YYYY-MM-DD&until=YYYY-MM-DD
```

## Step 3 — Force a full render (important)
Cells render lazily — rooms below the fold (especially the last room) show empty cells with no editable placeholder. To fix:
1. Wait ~3s after load until placeholders are populated (poll until count > 0).
2. Click the date-range field to open the picker, then press **Escape to close it** — the close triggers a re-render. The **first Escape sometimes doesn't close it; press Escape a second time.**
3. Render only applies to rooms in the viewport at close time. **Do not scroll afterward** (scrolling un-renders) — push the visible rooms immediately, then repeat the nudge for the next set.

## Step 4 — Set the cells
For each editable job, set `rooms-to-sell` for the room+date to the target value (see `setRoomInventory` helper in the recipe). After each edit, **re-read the placeholder to confirm** the new value — an immediate `{"after":null}` usually still committed; the re-read is the source of truth.

## Step 5 — Verify
- Confirm every editable cell now reads its target value on-page.
- Spot-check at least one cell per property after a fresh reload.

## Step 6 — Mark the queue (on the Mac)
```
cd "/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/channel-manager"
# pushed / already-at-target:
node db/sync-cli.mjs done <comma,separated,ids>
# past-dated, not pushable:
node db/sync-cli.mjs done <comma,separated,ids>
# anything that genuinely failed:
node db/sync-cli.mjs failed <id> "reason"
```
`done` is idempotent — safe to re-run.

---

## Efficiency notes
- The single biggest cost of an automated run is pulling price data you don't need — always use `--type inventory` (see sync-split brief).
- Staying logged in (cookies) is what saves the login hop; leaving a specific tab open saves almost nothing.
- The render nudge (Step 3) is the difference between a clean run and minutes of retrying empty cells — do it before every batch of cells.

## Known pitfalls
- `getBoundingClientRect of null` / `totalPlaceholders=0` → values still loading; wait and poll before editing.
- Date field position shifts (sticky vs top of page) — find it before clicking.
- Sandbox can `list` but not `done` — always mark the queue from the Mac.
- `sync-cli` may have been hitting a local `dev.db` instead of the Turso cloud DB — confirm the target before trusting the queue (see sync-split brief).
