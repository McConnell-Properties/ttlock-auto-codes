# Build brief — TTLock arrival: restore guest-code attribution + exclude service codes

**Problem.** `db/poll-ttlock-arrivals.mjs` currently marks a guest arrived on **any** successful keypad/card unlock since check-in (`recordType in {3,7}`), with no attribution:
```js
records.filter(r => r.success === 1 && (r.recordType === 3 || r.recordType === 7))
```
On changeover day the **cleaner** (and maintenance/host) opens the room with their own code, so the guest is wrongly flagged "arrived" and the amber no-show flag never fires. Restore precision **without** losing the recall the rewrite was after.

**Repo:** `channel-manager`. Files: `db/poll-ttlock-arrivals.mjs` (+ `app/crm/board.tsx` display). The job runs live via launchd. **TTLock READ-ONLY** (only `/v3/lockRecord/list`); writes only the `CrmRecord` arrival fields. `--dry-run` first.

## Changes
1. **Bring back the guest code per booking** (CODE removed it). Read it from the pipeline `checkin_data.json` by booking ref — the loader/path already exists in `lib/messaging.ts` → `lockCode`. Use it as the **strong** signal, but not mandatory (see fallback).
2. **Service-code exclusion list.** Port the known non-guest codes from the pipeline (`scripts/cleaner_report.py` `is_cleaner()` → `1213`, plus any maintenance/host/master codes used across properties). Keep as a documented config in this repo (note the source).
3. **New matching** per booking over `[checkIn 00:00 → now]`, `success==1`, `recordType in {3,7}`:
   - If a guest `lockCode` is known → arrived = an unlock with `keyboardPwd == lockCode` (**confirmed**).
   - Else → arrived = the earliest unlock whose `keyboardPwd` is **not** in the service-code list (**unattributed / weaker**).
   - **Always exclude service codes** in both branches.
   - `arrivedAt = earliest` matching unlock (first entry = arrival), not the latest.
4. **Record confidence.** Set `arrivedSource='auto'` for guest-code matches, `arrivedSource='auto-weak'` for the unattributed fallback. Never overwrite `arrivedSource='manual'`.
5. **`board.tsx` display:** confirmed → "✓ arrived {time}"; unattributed → muted "🔓 door opened {time}" with a tooltip. Amber no-show logic stays (`arrivedDetected != 'yes'`).

## Tests (dry-run fine; report PASS/FAIL)
1. A room with **only** a cleaner-code (`1213`) unlock on changeover day → **NOT** arrived (was wrongly `yes` before).
2. A guest-code unlock → arrived, `arrivedAt` = first such unlock, source=`auto`.
3. No code on file + a non-service unlock → arrived, source=`auto-weak`.
4. Manual override (`arrivedSource='manual'`) not overwritten by the job.
5. Seamless/Flat still skipped cleanly.

Optional: the 09:00/17:00 schedule misses evening arrivals until next morning — a ~21:00 run would catch more. Leave unless you want it.
