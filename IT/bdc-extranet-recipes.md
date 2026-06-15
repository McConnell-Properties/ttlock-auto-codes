---
name: bdc-extranet
description: Push prices and availability to the Booking.com Partner Hub extranet via Claude in Chrome. Use when asked to sync the channel manager queue to Booking.com / BDC, bulk-change prices or rooms-to-sell on the BDC extranet, or block/unblock rooms on Booking.com. Covers single-date edits (proven JS recipes, no screenshots) and the Bulk edit panel (date ranges).
---

# Booking.com Extranet — Prices & Availability

All recipes proven on the live extranet (2026-06-11 inventory, 2026-06-12 prices & bulk edit).

## Field notes from the first large push (2026-06-12, Tooting, 486 price updates, 0 errors)

- **Date-window navigation by URL** (no picker clicking): append
  `&view_mode=LIST&room_id=&from=YYYY-MM-DD&until=YYYY-MM-DD` to the calendar URL.
  Max window ~31 days. Full page load — re-inject helpers after every navigation.
- **Lazy rendering:** rooms below the fold have EMPTY cells (no placeholder). Before
  editing a room, `roomEl.scrollIntoView({block:'center'})` + wait ~1.2s. If a room
  still renders empty rows, open+close the date picker or scroll up/down to nudge a re-render.
- **Skip-check makes re-runs cheap:** read `placeholder` text first and skip if it already
  equals the target — so re-pushing a whole window after a partial failure is fast and safe.
- **Batch in one async JS call per room** (~31 dates ≈ 60–90s), with a progress marker in
  `window.__ap` and results in `window.__all` — poll with light JS calls between waits.
  Wrap the loop in try/catch that records FATAL into the result, or a mid-run re-render
  kills the run silently.
- **Timing:** ~1.5–2s per cell edit. A 6-room month-window ≈ 6–8 min unattended.
- **Queue bookkeeping:** leave jobs pending until a property's full horizon is pushed,
  then one "Mark all done" on the property card. Past-dated jobs can be marked done unpushed.

## Reading the work queue

The channel manager (in `IT/channel-manager/`) queues every change as sync jobs:

```bash
node db/sync-cli.mjs list booking.com   # pending jobs as JSON (price jobs pre-grouped into date ranges)
node db/sync-cli.mjs done 12,13,14      # mark done after pushing
node db/sync-cli.mjs failed 15 "note"   # mark failed
```

Each job/range includes `bdcHotelId`, `bdcRoomId`, dates, and target value. Skip room types with null `bdcRoomId`.

## Navigation

Calendar (list view) per property:
`https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id={HOTEL_ID}&lang=en&ses={SES}`

- The `ses=` token is session-specific. Get a valid one by navigating to `https://admin.booking.com/` first (it appears in the redirected URL), or navigate via the extranet menus. Never reuse a stored token.
- If a login page appears, ask Charlie to log in (2FA goes to his phone).
- The calendar shows ~1 month per load; the loaded window follows the date-range picker (top-left). Cells outside the loaded window return "cell not found" — change the picker or use Bulk edit for far dates.

### Property switching (verified 2026-06-13 via Claude in Chrome)

**One session token works for every property in the group** — switching properties is just changing `hotel_id` in the calendar URL; the `ses` token does NOT change per property.

Efficient flow:
1. Navigate once to `https://admin.booking.com/` — it lands on the **Group homepage** and the redirected URL contains a fresh `ses=...` token. Grab it. (If a login/2FA page appears, ask Charlie to log in — 2FA goes to his phone.)
2. For each property, navigate directly to its calendar (list view, ≤31-day window):
   `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id={HOTEL_ID}&lang=en&ses={SES}&view_mode=LIST&from=YYYY-MM-DD&until=YYYY-MM-DD`
3. To move to the next property, re-navigate the same URL with a different `hotel_id` (same `ses`). The page header confirms the active property (e.g. "Tooting Stays 13576893").

**Hotel IDs (group of 5):**

| Property | hotel_id |
|---|---|
| Streatham Rooms | 14715886 |
| Gassiot House | 15676333 |
| Tooting Stays | 13576893 |
| Valnay Stays | 15779662 |
| Seamless Stays | 12686318 |

After each navigation the page fully reloads, so re-inject the `setRoomInventory`/`setRoomPrice` helpers, and remember the lazy-rendering rule (scroll a room into view + wait ~1.2s before editing its cells).

## DOM map (calendar list view)

- Room block: `[data-test-id="room-{ROOM_ID}"]` (room ID also shown in the room header text)
- Rows inside a room block: `[data-test-id="rooms-to-sell-row"]` (inventory), `[data-test-id="rate"]` (price, under "Standard Rate")
- Date cell: `[data-test-id="cell-YYYY-MM-DD"]`
- Cell display/click target: `[data-test-id="placeholder"]`; clicking opens `input[data-test-id="editable"]`; **Enter** confirms
- Hotel IDs / room IDs: stored in the channel manager DB (Properties page) and `IT/room-type-mapping.md`. Streatham = hotel 14715886, rooms 1471588601/04/05/09/10/11/12.

## Recipe: single-date edits (fast path, no screenshots)

Inject once per page load, then one call per change:

```js
window.setCalendarCell = async function(roomId, rowTestId, date, value) {
  const row = document.querySelector(`[data-test-id="room-${roomId}"] [data-test-id="${rowTestId}"]`);
  if (!row) return 'ERROR: row not found';
  const cell = row.querySelector(`[data-test-id="cell-${date}"]`);
  if (!cell) return 'ERROR: cell not found (date outside loaded window)';
  const click = (el) => {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => el.dispatchEvent(new MouseEvent(t, o)));
  };
  const ph = cell.querySelector('[data-test-id="placeholder"]');
  const before = ph ? ph.textContent.trim() : null;
  click(ph);
  await new Promise(r => setTimeout(r, 400));
  const input = cell.querySelector('input[data-test-id="editable"]');
  if (!input) return 'ERROR: input did not appear';
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 700));
  const after = cell.querySelector('[data-test-id="placeholder"]');
  return JSON.stringify({ before, after: after ? after.textContent.trim() : null });
};
window.setRoomInventory = (roomId, date, v) => setCalendarCell(roomId, 'rooms-to-sell-row', date, v);
window.setRoomPrice     = (roomId, date, p) => setCalendarCell(roomId, 'rate', date, p);
```

The returned `{before, after}` is the verification — `after` must equal the target value.

Note: the Chrome JS tool rejects top-level `await`. Call as
`setRoomPrice(...).then(r => window.__r = r)` then read `window.__r` in a second call.

## Recipe: Bulk edit (date ranges — use for 3+ consecutive dates)

One bulk edit = one date range × one room type × one value. Flow (per range):

1. Click the room's **Bulk edit** button (in its header): real click OK, or JS `.click()` works.
2. Fill dates via JS (synthetic events work for inputs):
   ```js
   const setVal = (el, v) => {
     const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
     Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
     el.dispatchEvent(new Event('input', { bubbles: true }));
     el.dispatchEvent(new Event('change', { bubbles: true }));
   };
   const panel = document.querySelector('[data-test-id="date-from"]').closest('.av-general-modal__body');
   setVal(panel.querySelector('[data-test-id="date-from"]'),  '2026-07-08');  // inclusive
   setVal(panel.querySelector('[data-test-id="date-until"]'), '2026-07-09');  // inclusive
   ```
   Weekday filters: `[data-test-id="weekday-selector-weekday-0..6"]` checkboxes (0 = Mon), all ticked by default.
3. **Expand the accordion section with a REAL mouse click on its chevron** (synthetic `.click()` does NOT expand them; click coordinates of the ˅ icon on the right):
   - "Rooms to sell" → number-of-rooms input
   - "Prices" → rate plan `<select>` (pick "Standard Rate") + price text input
   - "Room status" → radios `[data-test-id="radio-open"]` / `[data-test-id="radio-close"]`
4. Fill via `setVal` (rate select: pick `options[1]`, then price input is the next visible input after the select).
5. Click the enabled **Save changes** button (real click). Success = green banner "Your changes were saved successfully!" and the calendar cells behind the panel update immediately.
6. Verify by reading 1–2 sample cells with the DOM map above, then `sync-cli done <ids>`.

The panel also has a "Multiple room types" tab (edit several room types in one save) — not yet explored.

## Verification & safety rules

- Always read `before` values; after a batch, spot-check at least one cell per room type.
- Never set prices on dates with `null`/missing CSV data; never touch rooms not in the mapping.
- If any step returns ERROR or the success banner doesn't appear, stop, screenshot, and report — don't retry blindly.
- Mark jobs `done` only after on-page verification; use `failed` with a note otherwise.
