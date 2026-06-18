# Cloud Migration Handoff — Beds24 Cron to GitHub Actions + Vercel

**Date:** 2026-06-18  
**Branch merged:** `cms-dev` → `main`  
**Status:** Token fixed, scheduled cron active, first clean run pending

---

## What this migration does

Replaces three Mac launchd jobs with GitHub Actions + Vercel serverless functions:

| Old (launchd, Mac-local) | New (GitHub Actions → Vercel) |
|---|---|
| `com.mcconnell.cm.beds24-push` | `POST /api/beds24/cron/push` |
| `com.mcconnell.cm.beds24-pull` | `POST /api/beds24/cron/pull` |
| `com.mcconnell.cm.beds24-sync-bookings` | `POST /api/beds24/cron/sync-bookings` |

Schedule: `*/10 * * * *` (every 10 minutes) via `.github/workflows/beds24-cron.yml`.  
Auth: `Authorization: Bearer <CRON_SECRET>` on each route, checked by `lib/cron-auth.ts`.  
The middleware (`middleware.ts`) explicitly bypasses `CM_API_KEY` auth for `/api/beds24/cron/*`.

---

## Files created / modified

| File | Change |
|---|---|
| `app/api/beds24/cron/push/route.ts` | New — pushes inventory queue to Beds24 |
| `app/api/beds24/cron/pull/route.ts` | New — pulls BDC/Airbnb bookings from Beds24 into hub |
| `app/api/beds24/cron/sync-bookings/route.ts` | New — syncs hub direct/Expedia bookings to Beds24 |
| `lib/cron-auth.ts` | New — Bearer token guard shared by all 3 routes |
| `lib/beds24.ts` | New — token manager + generic API helper |
| `lib/beds24-push.ts` | New — outbound inventory push logic |
| `middleware.ts` | Modified — added `/api/beds24/cron/` to bypass list |
| `lib/actions.ts` | Modified — added missing exports for WIP build |
| `lib/data.ts` | Modified — added 6 missing exports (extrasForBooking, etc.) |
| `.github/workflows/beds24-cron.yml` | New — 3-job workflow with response body logging |

---

## Vercel environment variables required

All set in Vercel production (`vercel env ls production`):

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Bearer token checked by `lib/cron-auth.ts` |
| `BEDS24_REFRESH_TOKEN` | Long-lived Beds24 API refresh token (see history below) |
| `DATABASE_URL` | Turso DB libsql URL |
| `DATABASE_AUTH_TOKEN` | Turso auth token |
| `CM_API_KEY` | CMS API key (not used by cron routes) |

GitHub repository secrets/variables (McConnell-Properties/ttlock-auto-codes):

| Name | Type | Value |
|---|---|---|
| `CRON_SECRET` | Secret | Same value as Vercel |
| `VERCEL_URL` | Variable | `https://mcconnell-cm.vercel.app` |

---

## Pull route: how it works

- Reads `beds24_pull_last` from `Setting` table (last run timestamp)
- First run default: 24h ago (Mac launchd already did historical backfill)
- Calls `GET /bookings?modifiedFrom=<timestamp>&count=100` (paginated)
- Every booking goes to `Beds24BookingShadow` (diff tool)
- BDC/Airbnb/Expedia bookings also ingested into `Booking` hub:
  - New booking → INSERT with auto-assigned physical room
  - Existing by channelRef but no beds24Id → stamp beds24Id
  - Cancelled → UPDATE status
- Saves `beds24_pull_last` checkpoint after each page (timeout-safe) and at end
- `maxDuration = 300` (5 min Vercel limit)

---

## Issues encountered during migration

### 1. `BEDS24_REFRESH_TOKEN` stored as empty string in Vercel
**Symptom:** Pull route returned `{"ok":false,"error":"fetch failed"}`.  
**Root cause:** When the Vercel env var was originally set, an empty value was stored. The Mac launchd was reading the token from the local `.env` file — which worked fine. The Vercel function never had a valid token.  
**Evidence:** `vercel env pull .env` → `BEDS24_REFRESH_TOKEN=""`. Beds24 API call returned `{"error":"Token not valid"}`.  
**Fix:** Generated a new invite code in Beds24 (Account → API → Generate Invite Code, all write permissions ticked) and exchanged it using the correct endpoint and header (see below).

### 2. Wrong endpoint and header for invite code exchange
**Symptom:** Every attempt at `GET https://api.beds24.com/v2/authentication/setup -H "setupCode: ..."` returned 401.  
**Root cause:** Two errors:
  1. Wrong base URL — should be `https://beds24.com/api/v2` not `https://api.beds24.com/v2`
  2. Wrong header name — should be `code` not `setupCode`
**How found:** Shell history showed a working Python script (`beds24-cms/beds24_client.py`) that used `beds24.com/api/v2` and `headers={"code": invite_code}`.  
**Correct curl:**
```bash
curl -sS "https://beds24.com/api/v2/authentication/setup" -H "code: INVITE_CODE"
```
Returns `{"token":"...","expiresIn":86400,"refreshToken":"..."}` — the `refreshToken` is what goes into Vercel.

### 3. Scheduled cron never fired automatically
**Symptom:** `beds24_pull_last` checkpoint stuck at Jun 17 23:35 despite cron supposedly running every 10 minutes. No new shadow records after Jun 17.  
**Root cause:** GitHub Actions scheduled workflows only run from the **default branch** (`main`). The workflow file was on the `cms-dev`/`beds24` branch — not main. Only manual `workflow_dispatch` triggers were working.  
**Fix:** Merged `cms-dev` into `main` and pushed. Scheduled cron now active.

### 4. `node_modules` and `.env` files committed to git
**Symptom:** `git push` rejected: `File IT/channel-manager/node_modules/@next/swc-darwin-arm64/next-swc.darwin-arm64.node is 109.64 MB` and `Push cannot contain secrets` (Stripe API key detected).  
**Root cause:** The initial commit included `node_modules/` and `.env` files with secrets.  
**Fix:** Used `python3 -m git_filter_repo` to remove `node_modules/`, `.next/`, and all `.env` files from all git history. Force pushed clean history to `main`.  
**Side effect:** Local `.env` was deleted from disk. Restored via `vercel env pull .env`.  
**`.gitignore` added** to prevent recurrence — excludes `node_modules/`, `.next/`, `.env*`, `*.log`, `*.tsbuildinfo`.

### 5. Checkpoint reset caused 5-minute timeout
**Symptom:** Manual workflow run timed out on pull job.  
**Root cause:** Checkpoint was manually reset to Jun 15 (3 days) to catch a suspected missed booking. 3 days of Beds24 bookings exceeded Vercel's 5-minute function limit.  
**Fix:** Checkpoint left at Jun 17 23:43 (natural state after the last successful run). The pull route already has per-page checkpointing so partial runs are safe.

### 6. Unrelated git histories on remote main
**Symptom:** `git pull origin main` failed with `refusing to merge unrelated histories`.  
**Root cause:** The GitHub repo's `main` branch had been initialised via the GitHub web UI (user created the workflow file through the UI during the previous session). This created an orphaned commit history disconnected from the local repo.  
**Fix:** Force pushed local `main` over the remote after filter-repo cleanup.

---

## Middleware bypass — critical detail

The `middleware.ts` checks all `/api/*` requests for a valid `CM_API_KEY` Bearer token or admin session cookie. Cron routes send `CRON_SECRET` instead. Without the bypass, every cron call returns 401 regardless of the correct secret.

The bypass is this block in `middleware.ts`:
```typescript
if (
  pathname === '/login' ||
  pathname === '/api/stripe/webhook' ||
  pathname.startsWith('/api/beds24/cron/')
) {
  return NextResponse.next();
}
```

If this line is ever removed or the middleware is rewritten, all 3 cron routes will break silently (GitHub sees HTTP 200 from the 401 response... actually no, it'll be 401 and the job will fail). Worth knowing.

---

## Beds24 token lifecycle

Beds24 v2 uses a two-token system:

| Token | Stored | Expires | Used for |
|---|---|---|---|
| **Refresh token** | Vercel env (`BEDS24_REFRESH_TOKEN`) | ~30 days | Getting new access tokens |
| **Access token** | Turso `Setting` table (`beds24_token`) | 24h | Actual API calls |

The `lib/beds24.ts` token manager:
1. Checks in-process cache first (fastest, per Vercel instance)
2. Falls back to `beds24_token` in Turso DB (shared across instances)
3. If expired or missing, calls `/authentication/token` with the refresh token

**The refresh token expires ~30 days after creation.** When it expires, every Beds24 API call will fail with `{"ok":false,"error":"BEDS24_REFRESH_TOKEN not set"}` (if empty) or `{"ok":false,"error":"Beds24 token refresh failed: HTTP 401"}` (if expired). The GitHub job logs will show this clearly thanks to the response body logging added to the workflow.

**To rotate the refresh token when it expires:**
```bash
# 1. Generate invite code in Beds24: Account → API → Generate Invite Code (all write permissions)
# 2. Exchange immediately (invite codes expire in minutes):
curl -sS "https://beds24.com/api/v2/authentication/setup" -H "code: PASTE_INVITE_CODE"
# 3. Copy the refreshToken from the response
# 4. Update Vercel:
npx vercel env rm BEDS24_REFRESH_TOKEN production --yes
npx vercel env add BEDS24_REFRESH_TOKEN production --value "PASTE_REFRESH_TOKEN"
```

Current token created: 2026-06-18. Expect to rotate around **2026-07-18**.

---

## Mac launchd jobs — retired

Retired on 2026-06-18 via `launchctl bootout`:
- `com.mcconnell.cm.beds24-push`
- `com.mcconnell.cm.beds24-pull`
- `com.mcconnell.cm.beds24-sync-bookings`

Plists parked in `automation/plists-parked/` as rollback. Safe to delete after the GitHub cron has been running cleanly for a week.

---

## Outstanding: Valnay not blocking calendar on BDC

**Symptom:** Valnay rooms remain open on Booking.com after a booking is made in the hub.

**Current state:** Inconclusive — the `BEDS24_REFRESH_TOKEN` was empty the entire time the GitHub cron was running, so the push route (`/api/beds24/cron/push`) was failing on every run with `fetch failed`. No availability updates were ever reaching Beds24, and therefore none reached BDC.

**DPR (Daily Price Rules):** Previously investigated and ruled out by Charlie. The git audit commit (`7c0dc08`) mentioned DPRs as a hypothesis but this was subsequently tested and disproven.

**Next step:** Now that the token is fixed, trigger the workflow manually and watch the **Push inventory** job logs. If the push returns `{"ok":true,...}` with non-zero updates, the next BDC sync should close the Valnay dates. If it returns `ok:true` but Valnay still doesn't block, the issue is upstream of the push (likely a room mapping or Beds24 channel config issue specific to Valnay).
