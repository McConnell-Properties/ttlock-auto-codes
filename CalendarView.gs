// ============================================================
// Google Sheets Multi-Calendar View — Google Apps Script
// Spec v1.0 | Generated for CRM workbook
// ============================================================
//
// HOW TO INSTALL
// 1. Open your Google Sheet
// 2. Extensions → Apps Script
// 3. Delete any existing code, paste this entire file
// 4. Save (Ctrl+S / Cmd+S)
// 5. Reload the spreadsheet — a "📅 Calendar" menu will appear
// 6. Run "📅 Calendar → Setup Config Sheet" first, fill in your
//    actual room inventory, then run "Refresh Calendar"
//
// SHEET NAMES REQUIRED
//   • "CRM"      — your reservations data (source of truth)
//   • "Config"   — created automatically by Setup Config Sheet
//   • "Calendar" — generated/overwritten on every Refresh
//
// ============================================================

// ---- Sheet names ----
var CRM_SHEET      = "CRM";
var CALENDAR_SHEET = "Calendar";
var CONFIG_SHEET   = "Config";

// ---- CRM column headers (exact match, case-sensitive) ----
// These match the column names found in your exported CSV.
var COL = {
  BOOKING_REF:  "Booking reference",
  FIRST_NAME:   "guest_first_name",
  LAST_NAME:    "guest_last_name",
  PHONE:        "guest_phone_number",
  PROPERTY:     "property_name",
  ROOM_TYPE:    "Room type",
  ROOM_NUMBER:  "rooms",
  ARRIVAL:      "Check in date",
  DEPARTURE:    "Check out date",
  PLATFORM:     "channel_name",
  STATUS:       "status"
};

// ---- Property colours (light / dark alternating shades per booking) ----
// Add a row here for any new property. Key must exactly match property_name.
var PROPERTY_COLOURS = {
  "Valnay Stays":     { light: "#C6EFCE", dark: "#70AD47" },
  "Gassiot House":    { light: "#FFEB9C", dark: "#FFBF00" },
  "Streatham Rooms":  { light: "#BDD7EE", dark: "#2E75B6" },
  "Tooting Stays":    { light: "#FCE4D6", dark: "#F4B183" },
  "DEFAULT":          { light: "#E2D5F3", dark: "#9B72CF" }
};


// ============================================================
// ENTRY POINT — called by the "Refresh Calendar" menu item
// ============================================================
function buildCalendar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast("Reading data…", "Calendar", -1);

  // 1. Config
  var config = readConfig(ss);
  if (!config) return;

  // 2. CRM reservations
  var reservations = readCRM(ss);
  if (!reservations) return;
  if (reservations.length === 0) {
    SpreadsheetApp.getUi().alert("No confirmed reservations found in the CRM sheet.");
    return;
  }

  // 3. Date range
  var dates = getDateRange(reservations);
  if (!dates) {
    SpreadsheetApp.getUi().alert("Could not determine date range from the CRM data.");
    return;
  }

  // 4. Prepare Calendar sheet (clear it completely)
  var calSheet = ss.getSheetByName(CALENDAR_SHEET);
  if (!calSheet) {
    calSheet = ss.insertSheet(CALENDAR_SHEET);
  } else {
    calSheet.clearContents();
    calSheet.clearFormats();
    try {
      calSheet.getRange(1, 1, calSheet.getMaxRows(), calSheet.getMaxColumns()).breakApart();
    } catch (e) { /* ignore if nothing to break */ }
  }

  // 5. Row structure from Config
  var rows = buildRowStructure(config);

  // 6–9. Build the grid
  ss.toast("Writing headers…", "Calendar", -1);
  writeHeaders(calSheet, dates);

  ss.toast("Writing rows…", "Calendar", -1);
  writeRowLabels(calSheet, rows);

  ss.toast("Plotting " + reservations.length + " reservations…", "Calendar", -1);
  plotReservations(calSheet, rows, reservations, dates);

  ss.toast("Applying formatting…", "Calendar", -1);
  applyFormatting(calSheet, rows, dates);

  ss.toast(
    "✅ Done — " + reservations.length + " reservations across " +
    Math.round((dates.end - dates.start) / 86400000 + 1) + " days.",
    "Calendar", 5
  );
}


// ============================================================
// READ CONFIG SHEET
// ============================================================
// Config layout (three side-by-side tables):
//   Col A         : Property Name
//   Col C, D      : Property | Room Type
//   Col E, F, G   : Property | Room Type | Room Number
// Headers in row 1, data from row 2 onwards.
// ============================================================
function readConfig(ss) {
  var sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(
      'No "Config" sheet found.\n\n' +
      'Run  📅 Calendar → Setup Config Sheet  to create one, then fill in your room inventory.'
    );
    return null;
  }

  var data = sheet.getDataRange().getValues();

  // Table 1 — Properties (col A, index 0)
  var properties = [];
  for (var r = 1; r < data.length; r++) {
    var v = String(data[r][0]).trim();
    if (v) properties.push(v);
  }

  // Table 2 — Room Types (cols C=2, D=3)
  var roomTypes = [];
  for (var r = 1; r < data.length; r++) {
    var prop = String(data[r][2]).trim();
    var rt   = String(data[r][3]).trim();
    if (prop && rt) roomTypes.push({ property: prop, roomType: rt });
  }

  // Table 3 — Rooms (cols E=4, F=5, G=6)
  var rooms = [];
  for (var r = 1; r < data.length; r++) {
    var prop = String(data[r][4]).trim();
    var rt   = String(data[r][5]).trim();
    var rn   = String(data[r][6]).trim();
    if (prop && rt && rn) rooms.push({ property: prop, roomType: rt, roomNumber: rn });
  }

  if (properties.length === 0) {
    SpreadsheetApp.getUi().alert(
      'The Config sheet has no properties in column A.\n' +
      'Please fill in Table 1 (Property Name) and try again.'
    );
    return null;
  }

  return { properties: properties, roomTypes: roomTypes, rooms: rooms };
}


// ============================================================
// READ CRM SHEET
// ============================================================
function readCRM(ss) {
  var sheet = ss.getSheetByName(CRM_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(
      'No "CRM" sheet found.\n\nPlease rename your reservations sheet to "CRM" and try again.'
    );
    return null;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  // Map header names → column indices
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  Object.keys(COL).forEach(function (key) {
    idx[key] = headers.indexOf(COL[key]); // -1 if column not found
  });

  var reservations = [];

  for (var r = 1; r < data.length; r++) {
    var row    = data[r];
    var status = idx.STATUS >= 0 ? String(row[idx.STATUS]).trim() : "";

    // Exclude cancelled bookings
    if (status.toLowerCase() === "cancelled") continue;

    var arrival   = parseDate(idx.ARRIVAL   >= 0 ? row[idx.ARRIVAL]   : null);
    var departure = parseDate(idx.DEPARTURE >= 0 ? row[idx.DEPARTURE] : null);
    if (!arrival || !departure || departure <= arrival) continue;

    var firstName  = idx.FIRST_NAME   >= 0 ? String(row[idx.FIRST_NAME]).trim()  : "";
    var lastName   = idx.LAST_NAME    >= 0 ? String(row[idx.LAST_NAME]).trim()   : "";
    var guestName  = [firstName, lastName].filter(Boolean).join(" ") || "—";

    reservations.push({
      bookingRef: idx.BOOKING_REF  >= 0 ? String(row[idx.BOOKING_REF]).trim()  : "",
      guestName:  guestName,
      phone:      idx.PHONE        >= 0 ? String(row[idx.PHONE]).trim()        : "",
      property:   idx.PROPERTY     >= 0 ? String(row[idx.PROPERTY]).trim()     : "",
      roomType:   idx.ROOM_TYPE    >= 0 ? String(row[idx.ROOM_TYPE]).trim()    : "",
      roomNumber: idx.ROOM_NUMBER  >= 0 ? String(row[idx.ROOM_NUMBER]).trim()  : "",
      arrival:    arrival,
      departure:  departure,
      platform:   idx.PLATFORM     >= 0 ? String(row[idx.PLATFORM]).trim()     : "",
      status:     status
    });
  }

  return reservations;
}


// ============================================================
// DATE HELPERS
// ============================================================
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    var d = new Date(val);
    d.setHours(0, 0, 0, 0);
    return isNaN(d) ? null : d;
  }
  var s = String(val).trim();
  if (!s) return null;

  // YYYY-MM-DD  (ISO — how Lodgify exports)
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  // DD/MM/YYYY
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);

  // Fallback
  var d = new Date(s);
  if (!isNaN(d)) { d.setHours(0, 0, 0, 0); return d; }
  return null;
}

function getDateRange(reservations) {
  var min = null, max = null;
  reservations.forEach(function (res) {
    if (!min || res.arrival   < min) min = res.arrival;
    if (!max || res.departure > max) max = res.departure;
  });
  return (min && max) ? { start: min, end: max } : null;
}

function addDays(date, n) {
  var d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function dateToKey(date) {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }


// ============================================================
// BUILD ROW STRUCTURE
// ============================================================
// Returns ordered array of descriptors used for both row labels
// and the row-lookup map when plotting reservations.
// ============================================================
function buildRowStructure(config) {
  var rows = [];

  config.properties.forEach(function (prop) {
    // Property header row
    rows.push({ type: "property", property: prop, roomType: null, roomNumber: null, label: prop });

    // Room types for this property (in Config order, de-duped)
    var seen = {};
    var myRoomTypes = config.roomTypes
      .filter(function (rt) { return rt.property === prop; })
      .map(function (rt) { return rt.roomType; })
      .filter(function (rt) { return seen[rt] ? false : (seen[rt] = true); });

    myRoomTypes.forEach(function (rt) {
      // Room type header row
      rows.push({ type: "roomType", property: prop, roomType: rt, roomNumber: null, label: rt });

      // Specific rooms
      config.rooms
        .filter(function (r) { return r.property === prop && r.roomType === rt; })
        .forEach(function (r) {
          rows.push({ type: "room", property: prop, roomType: rt, roomNumber: r.roomNumber, label: r.roomNumber });
        });

      // Always include an Unallocated catch-all row
      rows.push({ type: "room", property: prop, roomType: rt, roomNumber: "Unallocated", label: "Unallocated" });
    });
  });

  return rows;
}


// ============================================================
// WRITE DATE HEADERS (rows 1 and 2)
// ============================================================
function writeHeaders(sheet, dates) {
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  var row1 = ["Property", "Room Type", "Room"];
  var row2 = ["", "", ""];

  var cur = new Date(dates.start);
  while (cur <= dates.end) {
    row1.push(pad2(cur.getDate()) + " " + MONTHS[cur.getMonth()]);
    row2.push(DAYS[cur.getDay()]);
    cur = addDays(cur, 1);
  }

  sheet.getRange(1, 1, 1, row1.length).setValues([row1]);
  sheet.getRange(2, 1, 1, row2.length).setValues([row2]);
}


// ============================================================
// WRITE ROW LABELS (from sheet row 3 downwards)
// ============================================================
function writeRowLabels(sheet, rows) {
  var HEADER_ROWS = 2;
  rows.forEach(function (row, i) {
    var sheetRow = HEADER_ROWS + 1 + i;
    if      (row.type === "property") sheet.getRange(sheetRow, 1).setValue(row.label);
    else if (row.type === "roomType") sheet.getRange(sheetRow, 2).setValue(row.label);
    else                              sheet.getRange(sheetRow, 3).setValue(row.label);
  });
}


// ============================================================
// PLOT RESERVATIONS
// ============================================================
function plotReservations(sheet, rows, reservations, dates) {
  var HEADER_ROWS = 2;
  var LABEL_COLS  = 3;  // columns A, B, C

  // date key → 1-based column number
  var dateColMap = {};
  var cur = new Date(dates.start);
  var colIdx = LABEL_COLS + 1;
  while (cur <= dates.end) {
    dateColMap[dateToKey(cur)] = colIdx++;
    cur = addDays(cur, 1);
  }

  // row key → 1-based sheet row number (only "room" type rows)
  var rowMap = {};
  rows.forEach(function (row, i) {
    if (row.type === "room") {
      rowMap[rowKey(row.property, row.roomType, row.roomNumber)] = HEADER_ROWS + 1 + i;
    }
  });

  // Track booking count per property for alternating colours
  var bookingIdx = {};

  reservations.forEach(function (res) {
    // Exact room match first, then fall back to Unallocated row
    var sheetRow =
      rowMap[rowKey(res.property, res.roomType, res.roomNumber)] ||
      rowMap[rowKey(res.property, res.roomType, "Unallocated")];

    if (!sheetRow) return; // property/room-type not in Config — silently skip

    // Choose alternating colour shade for this booking
    var propKey = res.property;
    bookingIdx[propKey] = (bookingIdx[propKey] || 0) + 1;
    var palette  = PROPERTY_COLOURS[res.property] || PROPERTY_COLOURS["DEFAULT"];
    var bgColour = (bookingIdx[propKey] % 2 === 1) ? palette.light : palette.dark;

    // Cell display text: "First Last | +44 7700 900000"
    var cellText = res.phone ? res.guestName + " | " + res.phone : res.guestName;

    // Fill nights: arrival date (inclusive) → day before departure
    var d = new Date(res.arrival);
    var first = true;
    while (d < res.departure) {
      var col = dateColMap[dateToKey(d)];
      if (col) {
        var cell = sheet.getRange(sheetRow, col);
        cell.setValue(first ? "→ " + cellText : cellText);
        cell.setBackground(bgColour);
        cell.setFontSize(8);
        cell.setFontColor("#1A1A1A");
        cell.setWrap(false);
      }
      first = false;
      d = addDays(d, 1);
    }

    // Checkout arrow on departure day — only if the cell is empty
    // (another guest may be checking in the same day)
    var depCol = dateColMap[dateToKey(res.departure)];
    if (depCol) {
      var depCell = sheet.getRange(sheetRow, depCol);
      if (!depCell.getValue()) {
        depCell.setValue("← out");
        depCell.setBackground("#EEEEEE");
        depCell.setFontColor("#9E9E9E");
        depCell.setFontSize(7);
      }
    }
  });
}

function rowKey(property, roomType, roomNumber) {
  return property + "||" + roomType + "||" + roomNumber;
}


// ============================================================
// APPLY FORMATTING
// ============================================================
function applyFormatting(sheet, rows, dates) {
  var HEADER_ROWS = 2;
  var LABEL_COLS  = 3;
  var numDates    = Math.round((dates.end - dates.start) / 86400000) + 1;
  var totalRows   = HEADER_ROWS + rows.length;
  var totalCols   = LABEL_COLS + numDates;

  // Freeze header rows and label columns
  sheet.setFrozenRows(HEADER_ROWS);
  sheet.setFrozenColumns(LABEL_COLS);

  // Column widths
  sheet.setColumnWidth(1, 140); // Property
  sheet.setColumnWidth(2, 140); // Room Type
  sheet.setColumnWidth(3, 110); // Room
  for (var c = LABEL_COLS + 1; c <= totalCols; c++) {
    sheet.setColumnWidth(c, 115);
  }

  // ---- Header rows ----
  var headerRange = sheet.getRange(1, 1, HEADER_ROWS, totalCols);
  headerRange
    .setBackground("#1F3864")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 32);
  sheet.setRowHeight(2, 18);

  // ---- Weekend shading in date columns ----
  var cur = new Date(dates.start);
  for (var dc = 0; dc < numDates; dc++) {
    var col = LABEL_COLS + 1 + dc;
    if (cur.getDay() === 0 || cur.getDay() === 6) {
      // Shade the entire column (data rows only — not header, which was already styled)
      sheet.getRange(HEADER_ROWS + 1, col, rows.length, 1).setBackground("#F0F0F0");
      // Slightly different header shade for weekend columns
      sheet.getRange(1, col, HEADER_ROWS, 1).setBackground("#2E4F7E");
    }
    cur = addDays(cur, 1);
  }

  // ---- Data rows ----
  rows.forEach(function (row, i) {
    var sheetRow = HEADER_ROWS + 1 + i;
    sheet.setRowHeight(sheetRow, 26);

    if (row.type === "property") {
      sheet.getRange(sheetRow, 1, 1, totalCols)
        .setBackground("#2C3E50")
        .setFontColor("#FFFFFF")
        .setFontWeight("bold");
      sheet.setRowHeight(sheetRow, 30);
    } else if (row.type === "roomType") {
      sheet.getRange(sheetRow, 1, 1, totalCols)
        .setBackground("#D6E4F0")
        .setFontColor("#1A2B3C")
        .setFontWeight("bold");
    } else {
      // Subtle alternating row tint for readability
      if (i % 2 === 0) {
        sheet.getRange(sheetRow, 1, 1, LABEL_COLS).setBackground("#F7F9FC");
      }
    }
  });

  // ---- Vertical alignment for all data ----
  sheet.getRange(HEADER_ROWS + 1, 1, rows.length, totalCols).setVerticalAlignment("middle");

  // ---- Grid borders ----
  sheet.getRange(1, 1, totalRows, totalCols)
    .setBorder(true, true, true, true, true, true, "#CCCCCC", SpreadsheetApp.BorderStyle.SOLID);

  // Thicker right border after label columns
  sheet.getRange(1, LABEL_COLS, totalRows, 1)
    .setBorder(null, null, null, true, null, null, "#2C3E50", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // Thicker bottom border after header rows
  sheet.getRange(HEADER_ROWS, 1, 1, totalCols)
    .setBorder(null, null, true, null, null, null, "#2C3E50", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // ---- Merge property and room-type label cells vertically ----
  mergeGroupCells(sheet, rows, HEADER_ROWS, LABEL_COLS, 1, "property");
  mergeGroupCells(sheet, rows, HEADER_ROWS, LABEL_COLS, 2, "roomType");
}

/**
 * Merge consecutive rows in `col` that share the same group key.
 * col: 1-based column number
 * type: "property" or "roomType"
 */
function mergeGroupCells(sheet, rows, headerRows, labelCols, col, type) {
  var groupStart = null;
  var groupKey   = null;

  function flush(endIdx) {
    if (groupStart === null || groupKey === null) return;
    var startSheetRow = headerRows + 1 + groupStart;
    var count         = endIdx - groupStart;
    if (count > 1) {
      try {
        var r = sheet.getRange(startSheetRow, col, count, 1);
        r.merge();
        r.setVerticalAlignment("middle").setHorizontalAlignment("left");
      } catch (e) { /* ignore */ }
    }
  }

  for (var i = 0; i <= rows.length; i++) {
    var row = rows[i];
    var key = null;

    if (row && row.type === type) {
      key = type === "property"
        ? row.property
        : row.property + "||" + row.roomType;
    }

    if (key !== groupKey) {
      flush(i);
      groupKey   = key;
      groupStart = key !== null ? i : null;
    }
  }
}


// ============================================================
// MENU — added when the spreadsheet opens
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("📅 Calendar")
    .addItem("🔄 Refresh Calendar", "buildCalendar")
    .addSeparator()
    .addItem("⚙️ Setup Config Sheet", "setupConfigSheet")
    .addToUi();
}


// ============================================================
// SETUP HELPER — creates a starter Config sheet
// ============================================================
function setupConfigSheet() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ui  = SpreadsheetApp.getUi();
  var existing = ss.getSheetByName(CONFIG_SHEET);

  if (existing) {
    var resp = ui.alert(
      '"Config" sheet already exists',
      'Overwrite it with a fresh template?',
      ui.ButtonSet.YES_NO
    );
    if (resp !== ui.Button.YES) return;
    ss.deleteSheet(existing);
  }

  var sheet = ss.insertSheet(CONFIG_SHEET);

  // ---- Table 1: Properties (col A) ----
  sheet.getRange("A1").setValue("Property Name");
  [
    ["Valnay Stays"],
    ["Gassiot House"],
    ["Streatham Rooms"],
    ["Tooting Stays"]
  ].forEach(function (row, i) {
    sheet.getRange(2 + i, 1).setValue(row[0]);
  });

  // ---- Table 2: Room Types (cols C, D) ----
  sheet.getRange("C1:D1").setValues([["Property", "Room Type"]]);
  // Sample data — owner to replace with actual room types
  sheet.getRange("C2:D9").setValues([
    ["Valnay Stays",    "Double Room Shared Bathroom"],
    ["Valnay Stays",    "Twin Room with Private Bathroom"],
    ["Gassiot House",   "Double Room with Shared Bathroom"],
    ["Gassiot House",   "Twin Room with Shared Bathroom"],
    ["Streatham Rooms", "Double Room with Private Bathroom"],
    ["Streatham Rooms", "Superior King or Twin Room, with private bathroom"],
    ["Tooting Stays",   "Business Double Room"],
    ["Tooting Stays",   "Deluxe Double Room"]
  ]);

  // ---- Table 3: Rooms (cols E, F, G) ----
  sheet.getRange("E1:G1").setValues([["Property", "Room Type", "Room Number"]]);
  // Sample — owner to replace with actual room numbers
  sheet.getRange("E2:G7").setValues([
    ["Valnay Stays",    "Double Room Shared Bathroom",        "Room 1"],
    ["Valnay Stays",    "Double Room Shared Bathroom",        "Room 2"],
    ["Valnay Stays",    "Twin Room with Private Bathroom",    "Room 3"],
    ["Gassiot House",   "Double Room with Shared Bathroom",   "Room 1"],
    ["Gassiot House",   "Twin Room with Shared Bathroom",     "Room 7"],
    ["Streatham Rooms", "Double Room with Private Bathroom",  "Room 2"]
  ]);

  // ---- Style headers ----
  ["A1", "C1", "D1", "E1", "F1", "G1"].forEach(function (addr) {
    sheet.getRange(addr)
      .setBackground("#1F3864")
      .setFontColor("#FFFFFF")
      .setFontWeight("bold");
  });

  // ---- Section labels ----
  sheet.getRange("A1").setNote("Table 1 — One property per row (exact spelling matters)");
  sheet.getRange("C1").setNote("Table 2 — One room type per row, linked to a property");
  sheet.getRange("E1").setNote("Table 3 — One room per row, linked to property + room type. Room Number must match the 'rooms' column in CRM exactly.");

  sheet.autoResizeColumns(1, 7);

  ui.alert(
    '✅ Config sheet created',
    '"Config" sheet created with sample data.\n\n' +
    'NEXT STEPS:\n' +
    '1. In Table 1 (col A): confirm/update your property names — must match property_name in CRM exactly.\n' +
    '2. In Table 2 (cols C–D): list every room type per property — must match the "Room type" column in CRM exactly.\n' +
    '3. In Table 3 (cols E–G): list every room number per property+room type — must match the "rooms" column in CRM exactly.\n\n' +
    'Then run  📅 Calendar → Refresh Calendar.',
    ui.ButtonSet.OK
  );
}
