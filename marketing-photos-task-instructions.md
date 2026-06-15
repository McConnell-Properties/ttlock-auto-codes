# Task: One-time "Marketing Photos" task for cleaner

## Goal
Add a one-time instruction to the cleaner's daily task doc: the first time a
room shows a checkout after this is set up, add a task telling him to take
marketing photos of that room (he'll send them via WhatsApp — no upload
automation needed). Once a room has been flagged once, never flag it again.

## Step 1 — Build the room list ("Marketing Photos Tracker" tab)

Add a new tab called `Marketing Photos Tracker` to the **same Google Sheet**
as the CRM Dashboard, with these columns:

| Property | Room Number | Room Type | Photos Status |
|---|---|---|---|

- Populate one row per unique Property + Room Number combination across all
  properties (Streatham, Tooting, Gassiot, Valnay, and any others).
- Set `Photos Status` = `Pending` for every row initially.
- Source the unique room list from the reservation_status file at
  `/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT`
  (this shows every reservation/room across all properties) and/or the
  `CRM Dashboard` tab — Property is column D (index 3) and Room Number is
  column AA (index 26) in CRM Dashboard, same layout likely applies to
  reservation_status. **Open the reservation_status file first to confirm
  its actual column layout before writing the extraction script** — don't
  assume it matches CRM Dashboard exactly.
- Write a one-off script (e.g. `buildMarketingPhotoTracker()`) that:
  1. Reads CRM Dashboard (and/or reservation_status) data.
  2. Builds a de-duplicated list of `Property|Room Number|Room Type`.
  3. Writes header row + all rows to the new `Marketing Photos Tracker` tab,
     with `Photos Status = "Pending"`.
- Run this once manually to seed the tab. Don't re-run it after seeding (it
  would reset everyone back to "Pending").

## Step 2 — Modify the daily script

In `insertLondonDailyTaskList`, add logic so that when a room has a checkout
today AND its `Marketing Photos Tracker` status is `Pending`:
- Append an extra task row for that room: a marketing-photo task.
- Update that room's status to `Requested` in the tracker so it's never
  added again.

### Add a constant near the top:
```javascript
const MARKETING_PHOTOS_SHEET = 'Marketing Photos Tracker';
```

### Add a helper function:
```javascript
// Returns a map keyed by "Property_RoomNumber" -> { status, row }
function getMarketingPhotoStatusMap() {
  const sheet = SS.getSheetByName(MARKETING_PHOTOS_SHEET);
  const map = {};
  if (!sheet) return map;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const property = String(data[i][0]).trim();
    const room = String(data[i][1]).trim();
    const status = String(data[i][3] || '').trim(); // column D = Photos Status
    map[`${property}_${room}`] = { status, row: i + 1 };
  }
  return map;
}
```

### Inside `insertLondonDailyTaskList`, before the checkout loop:
```javascript
const photoStatusMap = getMarketingPhotoStatusMap();
const photoTrackerSheet = SS.getSheetByName(MARKETING_PHOTOS_SHEET);
const roomsToMarkRequested = []; // collect row numbers, update after loop
```

### Inside the checkout loop, where `checkOutStr === todayFormatted`, after
pushing the normal "Check out clean" task:
```javascript
const photoKey = `${property}_${roomNum}`;
const photoEntry = photoStatusMap[photoKey];
if (photoEntry && photoEntry.status.toLowerCase() === 'pending') {
    dynamicTasks.push([displayRoom,
      '📸 Marketing photos (one-time): take photos of this room ' +
      '(living area, bedroom, kitchen, bathroom) after cleaning and ' +
      'WhatsApp them over.']);
    roomsToMarkRequested.push(photoEntry.row);
}
```

### After the checkout loop (still inside `insertLondonDailyTaskList`,
before sorting/inserting `dynamicTasks`):
```javascript
roomsToMarkRequested.forEach(row => {
    photoTrackerSheet.getRange(row, 4).setValue('Requested'); // column D
});
```

## Step 3 — Cleaner-facing instructions
No change needed to the doc's general "All Properties" rows — the
marketing-photo task will appear automatically as its own row next to the
relevant room's checkout-clean task, only on the day it's first triggered,
and only once per room ever.

## Notes / things to verify before running
- Confirm the actual column layout of the reservation_status file before
  writing the Step 1 extraction script — don't assume it mirrors CRM
  Dashboard's column indices.
- Run `buildMarketingPhotoTracker()` (Step 1) only once, as a one-off setup.
- No "done" confirmation loop is needed — once a room is marked `Requested`,
  it's assumed handled.
