# Booking.com Inventory Automation — Findings & Recipe

**Status:** Proven working in browser console (Partner Hub Availability Calendar, list view). Not yet packaged as a Claude in Chrome skill or wired to a reservation trigger.

## Property
- `hotel_id=14715886`
- Page: Partner Hub > Calendar > Availability (list view)
- URL pattern: `.../extranet_ng/manage/calendar/index.html?hotel_id=14715886&lang=en&ses=...&source=nav`
  (the `ses=` token is session-specific — navigate via the extranet menu, don't hardcode it)

## Room name → Room ID map
| Room name | Room ID |
|---|---|
| Double room-Ensuite | 1471588601 |
| Twin Room, with full private kitchen and ensuite | 1471588604 |
| Quad room, with Shared Bathroom | 1471588605 |
| Basic Single Room with Shared Bathroom | 1471588609 |
| Triple Room with Private Bathroom | 1471588610 |
| Double or Twin Room with Private Bathroom | 1471588611 |
| Superior King or Twin Room | 1471588612 |

## DOM structure
- Each room type: `.av-cal-list-room[data-test-id="room-{ID}"]`
- Inventory row within it: `[data-test-id="rooms-to-sell-row"]`
- Date cell: `[data-test-id="cell-YYYY-MM-DD"]` (also has `data-dns="YYYY-MM-DD"`)
- Click target to open editor: `[data-test-id="placeholder"]` inside the cell
- Editor input: `input[data-test-id="editable"]` (number input, min 0 max 255)
- Confirm: **Enter key** (not click-away)
- Result: cell gets class `av-cal-list-cell--unavailable` when set to 0; placeholder `title` attribute shows the current value

## Proven JS recipe (run in page console or via Claude in Chrome's JS execution tool — no screenshots needed)

```js
async function setRoomInventory(roomId, date, value) {
  const cell = document.querySelector(`[data-test-id="room-${roomId}"] [data-test-id="rooms-to-sell-row"] [data-test-id="cell-${date}"]`);
  if (!cell) return 'ERROR: cell not found';

  const click = (el, x, y) => {
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => el.dispatchEvent(new MouseEvent(t, opts)));
  };

  // Open editor
  const placeholder = cell.querySelector('[data-test-id="placeholder"]');
  const r1 = placeholder.getBoundingClientRect();
  click(placeholder, r1.x + r1.width/2, r1.y + r1.height/2);
  await new Promise(r => setTimeout(r, 400));

  // Set value
  const input = cell.querySelector('input[data-test-id="editable"]');
  if (!input) return 'ERROR: input did not appear';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  input.focus();
  setter.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));

  // Confirm with Enter
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));

  await new Promise(r => setTimeout(r, 600));

  return JSON.stringify({
    cellClass: cell.className,
    inputStillOpen: !!cell.querySelector('input[data-test-id="editable"]'),
    confirmedValue: cell.querySelector('[data-test-id="placeholder"]')?.getAttribute('title')
  });
}

// Example usage:
// await setRoomInventory('1471588612', '2026-06-26', 0); // block the room
// await setRoomInventory('1471588612', '2026-06-26', 1); // restore availability
```

## Test log (2026-06-11)
- Room 1471588609 (Basic Single, Shared Bathroom), 2026-06-26: 0 → 1 (via Claude in Chrome, ~63 steps first run, 4 steps second run) — reverted, confirmed bookable
- Room 1471588605 (Quad, Shared Bathroom), 2026-06-26: 0 → 1 (via Claude in Chrome, 1-4 steps) — reverted, confirmed bookable
- Room 1471588612 (Superior King/Twin), 2026-06-26: 0 → 1 (via console JS recipe above, instant, no screenshots) — reverted, confirmed available

## Open items / next steps
1. Test `setRoomInventory()` on a different room/date pair to confirm generality (in progress)
2. Package as a Claude in Chrome skill via skill-creator (room map + recipe + usage instructions)
3. Map Expedia's extranet (separate DOM structure, not yet investigated)
4. Decide on email-trigger architecture: Cowork scheduled task polls Gmail for new reservation confirmations -> parses room/date -> calls setRoomInventory() via Claude in Chrome on the other channel(s)
5. Constraints: Cowork scheduled tasks require the Mac to be awake and Claude desktop open (no true push trigger available); 2FA currently goes to phone, considering routing to email/VOIP for automation
