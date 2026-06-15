# Brief — Verify today's Booking.com ingestion & automation health

**For:** Claude Code, running on the Mac inside `IT/channel-manager`.
**Why you (not Cowork):** the live DB is now **Turso cloud** (`.env` `DATABASE_URL=libsql://…`). The local `db/dev.db` is a **stale pre-migration copy** (frozen ~2026-06-13 10:47) — ignore it for state checks. You can load `.env`, reach Turso, and run `launchctl`; the Cowork sandbox can't, so it couldn't confirm any of this directly.

**Goal:** Confirm (1) today's Booking.com reservations actually landed in the *live* (Turso) source of truth, and (2) the ingestion automation is healthy. Report findings. **Read-only — do not modify bookings, tasks, or the DB.**

---

## 0. Confirm which DB is live (sanity check)

- Print the active target: `grep -E '^\s*DATABASE_URL' .env` — confirm it's a `libsql://` (Turso) URL, not `file:`.
- Note the local file is stale: `ls -l db/dev.db` and the newest `Booking.createdAt` in it will be ~Jun 12–13. Everything below must run against **Turso** (i.e. via the project's scripts/client that load `.env`), never the raw `db/dev.db` file.

## 1. Check the 7 confirmation numbers Cowork flagged

These are the **"Booking.com - New booking!"** emails received **2026-06-14** (from `noreply@booking.com` → `info@mcconnell-properties.com`). For each, confirm whether it's captured.

| Confirmation # | Property (from email) | Check-in |
|---|---|---|
| 6889910053 | Valnay | 2026-06-17 |
| 5611044996 | Streatham | 2026-08-07 |
| 6595506030 | Valnay | 2026-08-07 |
| 6595548479 | Valnay | 2026-08-07 |
| 6945827170 | Tooting | 2026-07-03 |
| 6004902844 | Valnay | 2026-07-21 |
| 5850244528 | Valnay | 2026-07-13 |

For each confirmation number, check **both** of these against the live Turso DB:
- `EmailBookingTask` where `channelRef` = the number (the poller records new bookings here first — `kind` should be `new`; `status` `pending` until the detail-fetch runs).
- `Booking` where `channelRef` = `BDC-<number>` (present only after the Claude-in-Chrome detail-fetch has turned the task into a real booking — may legitimately be absent yet).
- Also check `ProcessedEmail.subject LIKE '%<number>%'` to confirm the email itself was seen/handled.

Easiest path: `node db/email-tasks-cli.mjs list` and grep for each number, plus a small one-off query script that loads `.env` and runs `SELECT … FROM EmailBookingTask / Booking / ProcessedEmail WHERE channelRef/subject matches`. Mirror the `.env` loader and `createClient` setup already in `db/poll-booking-emails.mjs`.

**Expected result:** all 7 appear in `EmailBookingTask` (and `ProcessedEmail`). It's fine if some don't yet have a `Booking` row — that's the pending browser detail-fetch step, not a failure. Flag only numbers that appear **nowhere**.

## 2. Sweep the whole gap window (don't trust just the 7)

The local copy froze ~Jun 13 10:47, so verify nothing fell through across the whole window since then:
- Pull every `noreply@booking.com` "New/Modified/Cancelled booking!" email from **2026-06-13 onward** (Gmail), extract the confirmation numbers from the subjects.
- Diff that set against `ProcessedEmail` in Turso. Report any email **not** in `ProcessedEmail` (= unprocessed) and any `needs_review` rows in `EmailBookingTask`.

## 3. Automation health

- `bash automation/install.sh status` — confirm `com.mcconnell.cm.email-watch` and `com.mcconnell.cm.booking-emails` are loaded, last exit 0.
- `tail -n 5 automation/logs/booking-emails.log` and `automation/logs/email-watch.log` — confirm recent runs (within the last ~5 min / on new mail) and no errors.
- Confirm the always-on `email-watch` IMAP IDLE process is actually alive (it should appear in `launchctl list | grep mcconnell` with a PID, not just a label).

## 4. Report

Write a short summary:
- The 7 numbers: present / missing, and in which table(s).
- Any unprocessed emails or `needs_review` items from the gap sweep.
- Automation status (both jobs loaded, running, last exit codes, last log line).
- One line on the live DB confirmation (Turso URL active, local `dev.db` stale).

Do **not** change anything. If you find genuinely missing/unprocessed emails, list them with their confirmation numbers and propose the fix (e.g. a manual `node db/poll-booking-emails.mjs` run) rather than running it as part of this check.
