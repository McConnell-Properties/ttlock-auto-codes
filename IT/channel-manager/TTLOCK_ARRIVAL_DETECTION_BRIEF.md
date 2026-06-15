# Build brief — TTLock arrival detection (self-contained)

Build a job that marks each guest **arrived** by reading TTLock unlock records, plus a minimal CRM surface (manual override + amber "no-show chase" flag). This is the only task in this brief. It's additive and ships independently.

**Repos involved**
- This repo (the CMS): `channel-manager` — Next.js 14 / TypeScript, SQLite via `@libsql/client`, all SQL in `lib/data.ts`. Cloud DB is **Turso** (prod). Run from `/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager`.
- Pipeline repo (TTLock creds + scripts + data, **read-only reference**): `/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes`. Make sure this Claude Code session has access to both folders.

> **Present your plan + the resolved room→lockId map first, then stop for review before installing the launchd job or deploying.**

---

## Safety (read first)
- **TTLock is READ-ONLY here.** Only call `/v3/lockRecord/list`. Never create/modify/delete passcodes.
- **Production Turso DB.** Migration must be additive only. The job writes **only** the three arrival fields below — nothing else.
- **Self-load `.env`** in any script (same pattern already used by `db/sync-cli.mjs`, `db/queue-inventory.mjs`, `db/stripe-sync.mjs`) so it hits Turso, not the local `db/dev.db` fallback.
- Build a **`--dry-run`** that reads + prints what it *would* set and writes nothing. Use it before any live write.

---

## TTLock facts (discovery already done — don't re-investigate)

**Auth (TTLock Open API, EU region)**
- Base URL: `https://euapi.ttlock.com`
- Pipeline `.env` keys: `TTLOCK_CLIENT_ID`, `TTLOCK_CLIENT_SECRET`.
- OAuth token cached in the pipeline repo as `ttlock_token.json` (`access_token`, `refresh_token`, `openid`, `expires_at`; currently long-lived ~Aug 2026). Get/refresh logic lives in the pipeline's `scripts/cleaner_report.py::get_token()` — port it (or shell out / re-implement the same refresh call) rather than inventing a new flow.

**Unlock records**
- `scripts/cleaner_report.py::get_records(lock_id, start_ms, end_ms)` → `POST /v3/lockRecord/list` with params: `clientId`, `accessToken`, `lockId`, `startDate`, `endDate` (epoch ms), `pageNo`, `pageSize`. Paginates.
- Each record: `recordType` (**3 = Code Unlock**, 4 = Code Lock, 1 = App Unlock, **7 = Card/NFC**, 47 = Failed), `lockDate` (ms), `success` (1 = ok), `username`, **`keyboardPwd` = the actual code used**, `recordId`.

**Room → lockId map** — hardcoded in the pipeline's `scripts/cleaner_report.py` `PROPERTIES` dict (also in `multi_property_lock_codes.py`). Each property has a `front` (front-door lockId) + a `rooms` map of `"Room N" → lockId`. **Covered: Tooting, Streatham, Gassiot, Valnay.** Example: Streatham Room 7 = `26157268`, Room 8 = `30947344`. **Seamless Stays / "Flat" have `front: None` and no room locks → arrival detection cannot work there; skip them (manual only).** Copy the current map verbatim into a small documented config in this repo (note the source file + that it's mirrored from the pipeline).

**Per-booking guest code** — the pipeline writes `automation-data/checkin_data.json`, keyed by booking ref (e.g. `BDC-5149920930`):
```json
{ "guestName": "...", "checkIn": "2026-06-20", "checkOut": "2026-06-27",
  "arrivalTime": "15:00", "roomNumber": "Room 4", "lockCode": "0930",
  "stripeLink": "", "stripeStatus": "" }
```
So for any booking we already know room (→ lockId) **and** the guest's exact door code. **This repo already has a loader for this file** in `lib/messaging.ts` (path constant points at `…/ttlock-auto-codes/automation-data/checkin_data.json`) — reuse it.

**Simplest reliable "has the guest arrived?"**: resolve `lockId` from the room map, call `get_records(lockId, checkIn@00:00, now)`, treat as **arrived** if there's a record with `success==1`, `recordType in {3,7}`, and `keyboardPwd == booking.lockCode`; `arrivedAt = min(lockDate)` of matches. Optionally also check the property `front` lock with the same code.

---

## CMS facts you'll need
- `CrmRecord` is **1:1 with `Booking`** (PK `bookingId`, FK → `Booking(id)` ON DELETE CASCADE). It has no arrival columns yet.
- `lib/data.ts` exposes `upsertCrm(bookingId, fields)` which **whitelists keys against `CRM_FIELDS`** — so new fields must be added to `CRM_FIELDS` (and the `CrmRecord` type + `CrmRow`) to be writable.
- `crmRows(aheadDays, backDays)` LEFT JOINs `CrmRecord` onto bookings — use it (or a direct query) to get the booking window with CRM state.
- Bookings carry `physicalRoom`, `propertyId`, `channelRef` (the booking ref), `checkIn`, `checkOut`.
- Migration pattern: see `db/migrate-crm.mjs` (idempotent table create). Follow it but **also self-load `.env`** so it targets Turso.

---

## 1. Schema migration — `db/migrate-crm-arrival.mjs`
Idempotent (catch "duplicate column name"); run once vs cloud, once vs local. Add to `CrmRecord`:
- `arrivedDetected TEXT NOT NULL DEFAULT ''`  — `'' | yes | no`
- `arrivedAt DATETIME`
- `arrivedSource TEXT NOT NULL DEFAULT ''`  — `'' | auto | manual` (so the job never clobbers a manual override)

Then add the 3 fields to `CRM_FIELDS`, the `CrmRecord` type, and `CrmRow` in `lib/data.ts`.

## 2. The job — `db/poll-ttlock-arrivals.mjs`
- **Select** confirmed bookings where `checkIn <= today <= checkOut`. Need `bookingId`, `channelRef`, `property`, `physicalRoom`, `checkIn`.
- **Resolve code + room:** read `checkin_data.json` by booking ref → `{ roomNumber, lockCode }` (reuse the `lib/messaging.ts` loader/path). No entry/code → skip (manual).
- **Resolve lockId:** from the ported `PROPERTIES` map. Seamless/Flat → skip.
- **Auth:** reuse pipeline `TTLOCK_CLIENT_ID`/`SECRET` + `ttlock_token.json` (refresh if expired, same as `get_token`).
- **Detect:** `POST /v3/lockRecord/list` for the room lock (and optionally `front`) over `[checkIn 00:00ms → now ms]`, paginate. Arrived = `success==1` AND `recordType in {3,7}` AND `keyboardPwd == lockCode`. `arrivedAt = min(lockDate)` → store ISO.
- **Write rules:** skip rows where `arrivedSource == 'manual'`. On match → `upsertCrm(bookingId, {arrivedDetected:'yes', arrivedAt, arrivedSource:'auto'})`. **Never flip yes→no; don't write 'no' on mere absence** of an unlock (≠ no-show). Leave `''` until a real signal.
- Small delay between lock calls (shared token — respect rate limits). Token-refresh failure → log + exit non-zero, don't crash the launchd chain.
- Support `--dry-run` (prints booking ref, room, lockId, code, match?, wouldSet; writes nothing).

## 3. CRM surface (minimal, additive — `app/crm/board.tsx`)
- An **"Arrived?"** cell for arrival-day / in-stay rows showing `arrivedDetected` + `arrivedAt` (auto badge when source=auto).
- **Manual override** toggle (yes/no) → `upsertCrm` with `arrivedSource:'manual'` so the job won't overwrite.
- **Amber row highlight** ("chase — may not have arrived") when arrival time has passed (use the booking's `arrivalTime` if available, else default 16:00) AND `arrivedDetected != 'yes'`.

## 4. launchd job
Follow `automation/install.sh` + `automation/jobs/*.sh` + `run-job.sh`. New job `poll-ttlock-arrivals` every ~20 min (gating to arrival hours is fine). Log to `automation/logs/ttlock-arrivals.log`. Wire into `install.sh`. **Don't install until after review.**

## 5. Test checklist (report PASS/FAIL with verbatim output)
1. Migration idempotent on cloud + local; `CrmRecord` has the 3 new cols; Booking/CrmRecord counts unchanged.
2. `--dry-run` against cloud lists current arrival-window bookings with resolved lockId + code + match result; writes nothing.
3. A booking with a known unlock flips `arrivedDetected=yes` + `arrivedAt` (or demonstrate via dry-run if no live unlock available).
4. Manual override sets `source=manual` and survives a later job run (not overwritten).
5. Amber flag shows for an arrival-passed, not-arrived row.
6. A Seamless/Flat booking is skipped cleanly (no error).
