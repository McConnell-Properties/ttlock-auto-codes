# Calendar View — Setup Instructions

## Prerequisites
- The script assumes your reservations tab is named **`CRM`** (rename it if needed).
- Column headers must match these exact names (they already do in your current export):

| What | Column header in CRM sheet |
|---|---|
| Booking reference | `Booking reference` |
| Guest first name | `guest_first_name` |
| Guest last name | `guest_last_name` |
| Phone | `guest_phone_number` |
| Property | `property_name` |
| Room type | `Room type` |
| Room number | `rooms` |
| Check-in | `Check in date` |
| Check-out | `Check out date` |
| Platform | `channel_name` |
| Status | `status` |

---

## Step 1 — Paste the script

1. Open your Google Sheet.
2. **Extensions → Apps Script**.
3. Delete any existing code in the editor.
4. Paste the entire contents of `CalendarView.gs`.
5. **Save** (Ctrl+S / Cmd+S). Name the project anything you like (e.g. *Calendar View*).

---

## Step 2 — Authorise the script

1. Click **Run → buildCalendar** (or any function) once inside the editor.
2. Google will prompt you to review permissions — click **Review Permissions → Allow**.
3. This only happens once per Google account.

---

## Step 3 — Reload your spreadsheet

Close the Apps Script tab and reload the spreadsheet.  
A **`📅 Calendar`** menu will appear in the menu bar.

---

## Step 4 — Create and fill the Config sheet

1. Click **📅 Calendar → ⚙️ Setup Config Sheet**.
2. A `Config` sheet is created with sample data in three tables:

| Table | Columns | What to fill in |
|---|---|---|
| **Properties** | A | One property name per row — must match `property_name` in CRM exactly |
| **Room Types** | C, D | One row per property+room-type combination — must match `Room type` in CRM exactly |
| **Rooms** | E, F, G | One row per room — Room Number must match the `rooms` column in CRM exactly (e.g. `Room 4`) |

> **Tip:** You can look at your CRM data and use *Data → AutoFilter* to list unique values for `property_name`, `Room type`, and `rooms` to copy them precisely.

---

## Step 5 — Refresh the calendar

1. Click **📅 Calendar → 🔄 Refresh Calendar**.
2. The `Calendar` sheet is rebuilt from scratch. This takes 10–30 seconds depending on the number of bookings.

---

## Step 6 — Optional: Auto-refresh on open

To have the calendar rebuild every time the spreadsheet is opened:

1. In Apps Script: **Triggers** (clock icon in the left sidebar).
2. **+ Add Trigger**.
3. Function: `buildCalendar` | Event source: `From spreadsheet` | Event type: `On open`.
4. Save.

For a timed refresh (e.g. every 15 minutes):  
Event source: `Time-driven` | Type: `Minutes timer` | Every: `15 minutes`.

---

## Adding new rooms later

1. Open the `Config` sheet.
2. Add a row to **Table 2** if it's a new room type.
3. Add a row to **Table 3** with the property, room type, and room number.
4. Run **Refresh Calendar**.

---

## Colour scheme

Each property has a light and dark shade. Adjacent bookings on the same room row alternate between them so you can tell them apart at a glance.

To change colours, edit the `PROPERTY_COLOURS` object near the top of the script:

```javascript
var PROPERTY_COLOURS = {
  "Valnay Stays":     { light: "#C6EFCE", dark: "#70AD47" },
  "Gassiot House":    { light: "#FFEB9C", dark: "#FFBF00" },
  "Streatham Rooms":  { light: "#BDD7EE", dark: "#2E75B6" },
  "Tooting Stays":    { light: "#FCE4D6", dark: "#F4B183" },
  "DEFAULT":          { light: "#E2D5F3", dark: "#9B72CF" }
};
```

Use any hex colour code. Google Sheets colour picker can help you find a code.

---

## Edge cases handled

| Scenario | Behaviour |
|---|---|
| Room not yet assigned in CRM | Placed in the **Unallocated** row for that room type |
| Departure day = another guest's arrival day | Departure cell shows `← out` in grey; arrival cell shows `→ Name \| Phone` for the incoming guest |
| No phone number in CRM | Cell shows name only |
| Cancelled booking | Excluded entirely from the calendar |
| Booking spans a month boundary | Handled naturally — dates are continuous columns |
| Property not in Config | Booking is silently skipped; add it to Config and refresh |
