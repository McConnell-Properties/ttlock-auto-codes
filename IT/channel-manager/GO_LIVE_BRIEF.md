# Build brief — Go live: cloud migrations + deploy the admin

Get the accumulated CMS changes live on the deployed Vercel admin so staff can see them. Self-contained.

**Repo:** this one, `channel-manager`. Run everything from `/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager` **on the Mac** (needs network, the live `.env`, and the Vercel CLI). Deployed admin: `https://mcconnell-cm.vercel.app` (Vercel project `mcconnell-cm`).

> The local launchd jobs (incl. `poll-ttlock-arrivals`) are already live and writing to the cloud Turso DB. This task only runs the cloud schema migrations and redeploys the Next.js admin so the new UI/endpoints go live.

---

## Safety
- **Production Turso DB** — the migrations are **additive only** (ALTER … ADD COLUMN, idempotent, catch "duplicate column name"). They do not touch existing data. Safe to re-run.
- Both migration scripts **self-load `.env`** and target `DATABASE_URL` (Turso), so a plain `node db/…` run hits the cloud DB. Confirm `.env` has the `libsql://…` URL + token before running.
- **Order matters:** run the migrations **before** `vercel --prod`. The new CRM query (`crmRows`) selects the new columns; deploying new code against a DB missing them would 500 the CRM page.

## Steps
```bash
cd "/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager"

# 1. Cloud schema migrations (idempotent — adds arrival + check-in columns to CrmRecord)
node db/migrate-crm-arrival.mjs
node db/migrate-checkin-fields.mjs

# 2. Deploy the admin
vercel --prod
```

## Verify (report back)
1. Migrations printed success / "already exists" with no errors; confirm against cloud that `CrmRecord` now has: `arrivedDetected, arrivedAt, arrivedSource, arrivalTime, contactMethod, contactValue, cardSaved, preArrivalCompletedAt, confirmedAt, preArrivalNotes` (read-only check, e.g. `PRAGMA table_info(CrmRecord)` via `turso db shell`).
2. `https://mcconnell-cm.vercel.app/crm` loads (after login) with the **Arrived?** column rendering — no 500. Spot-check that arrival data the local job has written shows up.
3. `https://mcconnell-cm.vercel.app/multical` shows the **Back 7 / Today / Forward 3** nav and navigates.
4. Quick regression: `/api/availability`, `/api/properties`, `/api/bookings` still return normally; `/api/checkin/upsert` exists (a bad-body POST with the Bearer key returns 400, not 404).
5. Report the deployed URL/build id and any warnings.

## In scope vs not
- **Live after this:** multical nav, TTLock Arrived? column + amber flag, the `/api/checkin/upsert` ingestion endpoint, the new check-in CrmRecord fields.
- **NOT in this release (separate briefs, code not written yet — don't build here):** cooking-pack CRM display + paid-only extras gating; the TTLock guest-code attribution fix (Arrived? currently over-reports cleaner/changeover unlocks).

Stop and report if any migration errors or the deploy fails — do not force-push a partial state.
