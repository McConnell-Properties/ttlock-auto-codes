# Missing Reservations Report
**Date:** 15 June 2026  
**Prepared by:** Automated audit (Claude Code session)

---

## Summary

A cross-check of `processed_bookings.json` against the Turso cloud database revealed **51 confirmed BDC reservations** that had been scraped and marked as processed by the email monitor but were never written to Turso, never had TTLock door codes issued, and never had Stripe deposit links created.

All 51 have **future check-in dates** (June–December 2026). None are historical/past stays.

---

## Root Cause

### Two email monitors writing to the same lock file

The pipeline has two separate scripts that both process BDC booking emails:

| Script | Purpose | Writes to Turso? | Issues TTLock? | Issues Stripe? |
|---|---|---|---|---|
| `gmail_monitor.py` | General email watcher — detects BDC emails, calls legacy export pipeline | ❌ No | ❌ No | ❌ No |
| `bdc_email_monitor.py` | BDC-specific scraper — full new pipeline | ✅ Yes | ✅ Yes | ✅ Yes |

Both scripts share a single deduplication log: `automation-data/processed_bookings.json`. When a new BDC booking email arrives:

1. **`gmail_monitor.py` runs first** (it runs on a tight schedule via launchd), detects the BDC email, calls the old Sheets-only export pipeline, then **marks the ref as logged** in `processed_bookings.json`.
2. **`bdc_email_monitor.py` runs later**, checks `is_already_logged(ref)` → finds it already in the JSON → logs `"Already logged: BDC-XXXXXXX — skipping"` → **exits without doing anything**.

Result: the booking lands in Google Sheets (via the old pipeline) but never reaches Turso, TTLock, or Stripe.

### Secondary factor: BDC scraper failures on some emails

For a subset of bookings (primarily those labelled "New last-minute booking" in the email subject), `bdc_email_monitor.py` attempted to scrape the BDC extranet page but returned empty data. This caused it to return early — *without* marking the booking as logged. However, `gmail_monitor.py` subsequently marked those same refs as logged before `bdc_email_monitor.py` could retry successfully.

### Why did some bookings make it through?

Bookings that were processed correctly (e.g. BDC-6749170359, BDC-6489453263 at first attempt) happened to be scraped by `bdc_email_monitor.py` in the narrow window before `gmail_monitor.py` could mark them as logged. These are the exception, not the rule.

---

## Scope of Impact

| Category | Count |
|---|---|
| Total refs in `processed_bookings.json` | 131 |
| Already in Turso (correct) | 80 |
| Cancelled bookings (correctly absent from Turso) | 17 |
| Confirmed bookings **missing from Turso** | **51** |

Of the 51 missing:
- **0 are past stays** — every single one has a future check-in date
- **2 checked in today** (Jun 15): Muhammad Shirjeel Jamal, Katarzyna Korzun
- **3 checked in tomorrow** (Jun 16): Nigel Fitton (Seamless), Caleb Kwawukumey (Seamless), + Akbar Khazmi (already in Turso)
- **1 checks in Jun 17**: L a Miraj (Valnay)
- Remaining 45 check in Jun 20 – Dec 2026

---

## Actions Taken Today (15 June 2026)

### Manually inserted into Turso

| Ref | Guest | Property | Room | Check-in | Check-out |
|---|---|---|---|---|---|
| BDC-6489453263 | Muhammad Shirjeel Jamal | Gassiot House | Room 1 | 15 Jun | 21 Jun |
| BDC-5847074342 | Katarzyna Korzun | Gassiot House | unallocated* | 15 Jun | 20 Jun |
| BDC-5123776681 | Nigel Fitton | Seamless Stays | Room 3 | 16 Jun | 19 Jun |
| BDC-5452111347 | Caleb Kwame Kwawukumey | Seamless Stays | unallocated* | 16 Jun | 18 Jun |
| BDC-6889910053 | L a Miraj | Valnay Stays | Room 6 | 17 Jun | 18 Jun |
| BDC-5850275699 | Jayesh mirpuri | Valnay Stays | Room 3 | 20 Jun | 21 Jun |
| BDC-6004957821 | George Davidson | Gassiot House | Room 3 | 20 Jun | 21 Jun |
| BDC-6595500443 | Toba Grace Mnyama | Streatham Rooms | Room 9 | 26 Jun | 29 Jun |
| BDC-6004951697 | Ignacy Balabuch | Streatham Rooms | unallocated* | 28 Jun | 3 Jul |
| BDC-6945827170 | Laura Weigang | Tooting Stays | Room 2 | 3 Jul | 5 Jul |
| BDC-5850244528 | Janette Lever | Valnay Stays | unallocated* | 13 Jul | 17 Jul |
| BDC-5123723959 | MALCOLM POWELL | Valnay Stays | Room 5 | 14 Jul | 16 Jul |

*Unallocated = overbooking detected; left as null intentionally per instruction.

### TTLock codes issued

Codes were issued (front door + room where applicable) for all bookings above with known room assignments. All codes use last-4-digits of the BDC reservation number.

**Hardware failures encountered:**
- BDC-5850275699 (Valnay Room 3, Jun 20): room lock gateway returned `-3003` (busy) — front door code set, room code failed after 3 retries
- BDC-5123723959 (Valnay Room 5, Jul 14): room lock returned `-2012` (not connected to gateway) — hardware check needed
- Seamless Stays: no TTLock locks configured for this property — no codes issued

### Stripe deposit links created

| Ref | Guest | Link status |
|---|---|---|
| BDC-6489453263 | Muhammad Shirjeel Jamal | Deferred — 6-night stay, triggers 3 days before checkout (18 Jun) |
| BDC-5847074342 | Katarzyna Korzun | ✅ Created |
| BDC-6889910053 | L a Miraj | ✅ Created |
| All others | — | Deferred — timing window not yet open |

---

## Still Outstanding

### 40 bookings not yet in Turso (check-in Jul 14 – Dec 2026)

These were not present in the 5 XLS exports provided (which covered Jun 14 – Jul 14). A further BDC extranet export covering Jul 14 onwards is needed to backfill them. They are lower urgency given their check-in dates.

### Room conflicts (unallocated)

Four bookings were inserted with `physicalRoom = NULL` due to detected overbooking on the room type. These need manual room assignment once the property situation is confirmed:

| Ref | Guest | Property | Room Type | Conflict |
|---|---|---|---|---|
| BDC-5847074342 | Katarzyna Korzun | Gassiot | Twin/Cozy (Room 3) | EXP-2471271477 in Room 3 Jun 13–16 |
| BDC-5452111347 | Caleb Kwawukumey | Seamless | Room 1 | Room 1 occupied Jun 16–18 |
| BDC-6004951697 | Ignacy Balabuch | Streatham | Superior King/Twin | Rooms 5+6 both occupied Jun 28–Jul 3 |
| BDC-5850244528 | Janette Lever | Valnay | Business Double | All Business rooms occupied Jul 13–17 |

---

## Fix Recommendation

**Short term:** Continue the XLS import approach for the remaining 40 bookings.

**Root cause fix:** Stop `gmail_monitor.py` from marking BDC booking refs as logged in the shared JSON. Options:

1. **Preferred:** Remove the `mark_booking_logged` call in `gmail_monitor.py` for BDC refs (refs starting `BDC-`), so `bdc_email_monitor.py` always gets first and only write.
2. **Alternative:** Give `bdc_email_monitor.py` its own separate deduplication log (`bdc_processed.json`) so the two pipelines do not share a lock file.

Without this fix, every new BDC booking will continue to bypass the new pipeline and arrive in Sheets only — missing Turso, TTLock, and Stripe.
