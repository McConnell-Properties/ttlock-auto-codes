---
name: expedia-extranet
description: Push prices and availability to Expedia Partner Central (EPC) via Claude in Chrome. Use when asked to sync the channel manager queue to Expedia, bulk-change rates or inventory on EPC, or open/close rooms on Expedia. Covers the Rates & Availability grid (single dates, proven) and the Bulk Update wizards (date ranges).
---

# Expedia Partner Central — Prices & Availability

Discovered & tested on the live extranet 2026-06-12 (Streatham). Inventory edit proven end-to-end (1→2→1, saved + reverted).

## Reading the work queue

```bash
node db/sync-cli.mjs list expedia      # pending jobs as JSON (price jobs grouped into ranges)
node db/sync-cli.mjs done 12,13,14
```

RoomType DB columns: `expediaRoomId`, `expediaRatePlanId` (Streatham complete incl. rate plans; Tooting rooms only; Gassiot/Valnay suspended — scrape when reactivated).

## Navigation

- Rates & Availability grid: `https://apps.expediapartnercentral.com/lodging/roomsandrates/ratesAndAvail.html?htid={EXPEDIA_PROPERTY_ID}`
- Bulk inventory wizard: `.../roomsandrates/bulkinventory.html?htid={ID}`
- Bulk rates wizard: `.../roomsandrates/bulkRates.html?htid={ID}`
- No session token in URLs (cookie-based). If login appears, ask Charlie (2FA).
- Property IDs: Streatham 124402141, Tooting 114536696, Gassiot 124830615 (suspended), Valnay 124213592 (suspended).

## Rates & Availability grid (single dates / small batches)

Deterministic element IDs:

- Inventory input: `inventory_{roomId}_{YYYY-MM-DD}`
- Open/close toggle button: `roomBookable_{roomId}_{YYYY-MM-DD}`
- Rate input: `rate_{ratePlanId}_{YYYY-MM-DD}-{occupancy}` (occupancy 1..4 — **per-occupancy pricing**, see below)
- Rate-plan open/close: `rateBookable_{ratePlanId}_{date}`

**Date navigation quirk:** the Date textbox ignores typed input. Click it to open the picker, click the **>** arrow (top-right of picker) once per month, then click the day. Grid shows ~18 days from the selected date.

**Edit recipe (proven):** real-click (triple-click) the cell → type value → press Tab → a save bar appears bottom-right → click **Update now** → toast "Success! All updates have been saved." Multiple cells can be edited before one Update now (batch-friendly). Verify by reading the input values back via JS; read `before` values first for reversibility.

**Scraping room/rate-plan IDs for a property** (run on its grid page):
```js
// rooms: header text "Name (ID: 123 • Code: 456)"; rate plans: walk inputs in DOM order
const seen = {}; [...document.querySelectorAll('*')].forEach(e => {
  const m = (e.textContent||'').replace(/\s+/g,' ').trim().match(/^(.{3,80}?) \(ID: (\d+) • Code: (\d+)\)\s*(\d+) rate plans?$/);
  if (m && !seen[m[2]]) seen[m[2]] = { name: m[1], roomId: m[2] };
});
const map = {}; let cur = null;
[...document.querySelectorAll('input[id^="inventory_"], input[id^="rate_"]')].forEach(i => {
  const m1 = i.id.match(/^inventory_(\d+)_/); const m2 = i.id.match(/^rate_(\d+)_\d{4}-\d{2}-\d{2}-(\d)$/);
  if (m1) cur = m1[1]; else if (m2 && cur) { (map[cur] = map[cur] || {})[m2[1]] = Math.max(map[cur][m2[1]]||0, Number(m2[2])); }
});
JSON.stringify({ rooms: Object.values(seen), ratePlansByRoom: map })
```

## Bulk Update wizards (date ranges — use for the big pushes)

Both wizards share section 1 (dates): inputs `#startDate`, `#endDate` (mm/dd/yyyy — synthetic setVal + input/change/blur events WORK here), weekday checkboxes `#checkbox-Sun`..`#checkbox-Sat`, then **Add to Calendar** → **Next Section**. Limit: 2 years ahead.

**Bulk inventory** (`bulkinventory.html`), section 2: per room type, inventory input `#availability{roomId}` + open/close select `#closed{roomId}` (No Change / Close / Open). Blank = no change, so one submission can update every room type for the range. Then the wizard's final confirm/submit.

**Bulk rates** (`bulkRates.html`): section 2 = rate-plan checkboxes `#ratePlanId{planId}` → Next Section → section 3: radio `#update-rates`; days (`#updateMethodSelectAllDaysSelected` or by-DOW); rate entry type — choose **Specific rates** (`#updateMethodSpecificObp`, NOT incremental); base rate input + `#numOccupantsSelect` (1/2 occupants) + "Additional per occupant" (GBP/%); then **Preview Updates** → **Submit**.

## Per-occupancy pricing (IMPORTANT — confirm policy with Charlie)

Expedia rates are per occupancy. Observed pattern on Streatham: rate for 1 occupant = rate for 2 occupants − £5 (e.g. 102.5/107.5, 71.75/76.75). Treat the channel-manager price as the 2-occupant rate and set 1-occupant = price − 5, EXCEPT single rooms (max occupancy 1) where the price is the 1-occupant rate. Confirm this rule with Charlie before the first large push.

## Verification & safety rules

- Read `before` values first; after saving, confirm the success toast AND re-read 1–2 cells.
- Rooms with 2 rate plans (Streatham Executive Houses: `408369639|408391232`, `408367499|408391299`): identify which plan is the standalone standard rate on-page before updating; update only it unless told otherwise.
- Tooting EPC has an unmapped room "Business Double Room, Shared Bathroom" (ID 328083353) — don't touch it; ask Charlie what it is.
- Gassiot & Valnay are suspended on Expedia — skip their jobs (mark failed with note) until reactivated.
- Never submit a wizard whose Preview shows more dates/rooms than intended; Cancel/Reset and report.
