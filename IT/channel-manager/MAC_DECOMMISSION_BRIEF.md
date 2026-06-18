# Mac → Vercel/Turso Full Decommission Brief

**Owner of this brief:** DESKTOP (Claude). **Implementer:** Claude Code (CC).
**Decision (Charlie, 2026-06-17):** move **everything** off the Mac mini. Full decommission.
**Cutover style:** staged — deploy to Vercel, test on the `*.vercel.app` URL, *then* flip DNS.
Keep the Mac (pm2 + cloudflared + launchd) **parked as rollback for ~1 week**, then retire.

> ⚠️ **LIVE PAYMENTS + LIVE GUESTS.** The booking-site takes real Stripe charges and is the
> gate that reveals a guest's room number. Do **not** run `vercel --prod` for the booking-site,
> change DNS, or repoint Stripe webhooks until Charlie confirms. Build + test on preview URLs.

---

## 0. Why this exists

The booking-site (`streathamrooms.co.uk`) and several background jobs still run **on the Mac mini**
(pm2 + Cloudflare tunnel + launchd). If the Mac sleeps, a guest who has just paid their deposit is
stuck at "finding your room", and door codes / inbound syncs stall. The CM (`mcconnell-cm`) is
already on Vercel; this brief moves the rest.

**Guiding principles**
1. **No local filesystem on Vercel.** Every `.data/*.json`, every CSV read, every `dev.db` read must
   become Turso (the source of truth) or a CM API call. Serverless fs does not persist.
2. **One owner of Turso.** The CM owns writes to Turso. Where the booking-site needs shared state,
   prefer calling the **CM API** over opening a second Turso writer (avoids races). Direct Turso
   *reads* from the booking-site are acceptable for hot paths if CC judges the API hop too slow.
3. **No split-brain during cutover** (see §2 — this is the most important safety step).
4. **Additive, branch off the deploy line, stop before prod/DNS.** Coordinate in `AGENT_HANDOFF.md`.

---

## 1. Inventory — what is still tied to the Mac

### 1a. Booking-site local-file state (breaks on Vercel) → Turso
| File | Local store | What it holds | Criticality |
|---|---|---|---|
| `booking-site/lib/depositRecord.ts` | `.data/deposits.json` | **The room-reveal gate** (deposit status/PI) | 🔴 critical |
| `booking-site/lib/bookings.ts` | `.data/processed-payments.json` | Idempotency ledger — stops double-charging / double-booking | 🔴 critical |
| `booking-site/lib/checkinContacts.ts` | `.data/checkin-contacts.json` | Guest contact + check-in answers | 🟠 |
| `booking-site/lib/inventory.ts` + `lib/portal.ts` | `.data/extras-requests.json` / `.csv` | Paid extras orders | 🟠 |

Note: the deposit webhook and check-in flow **already push** to the CM via `postCheckinUpsert` →
`/api/checkin/upsert` (`lib/cm.ts`). So the CM/Turso likely already has much of this. Lean into that:
make the booking-site read/write this shared state **through the CM API**, and delete the local-file
copies. Add a CM endpoint to *read back* deposit status for the room-reveal gate if one doesn't exist.

### 1b. Stale local SQLite reads (latent bug + Mac dependency) → CM API / Turso
These read `../channel-manager/db/dev.db`, which is **STALE** (source of truth moved to Turso cloud).
They must call the CM API (or Turso) instead:
- `booking-site/lib/portal.ts` — `findBookingByRef` (guest portal login by ref+surname) 🔴
- `booking-site/app/api/stripe-webhook/route.ts` — booking lookup on payment 🔴
- `booking-site/lib/dynamicPricing.ts` — pricing reads
- `booking-site/lib/switchQuote.ts` — quote engine

### 1c. CSV / external-dir reads (no such path on Vercel) → Turso
- `lib/switchQuote.ts` → `../../special quote` dir; writes `reservations.csv` / `pricing.csv`
- `lib/discounts.ts` → `QUOTE_DIR/data/discounts.csv`
- `lib/reservationStatus.ts` → a reservation-status CSV
- `lib/portal.ts` → `RES_STATUS` CSV + `CHECKIN_DATA` JSON
Pricing/discounts source of truth is the Google Sheet → Turso. These should read from **Turso**, not
local CSVs. CC: confirm each is still needed; some may be dead once Turso is the source.

### 1d. localhost coupling → public CM URL
`booking-site/lib/cm.ts` probes `localhost:3000–3003`. Replace with the public CM base
(`mcconnell-cm` Vercel project) + `CM_API_KEY` bearer (the client already supports `CM_API_KEY`).

### 1e. Mac launchd jobs → Vercel cron / external scheduler
| Job | Current cadence | Target |
|---|---|---|
| `beds24-pull.sh` (`db/beds24-pull.mjs`) | safety-net poll | Covered by the **Beds24 sync Vercel port** (separate brief in this log) |
| `beds24-push` / mirror | — | Same — see Beds24 brief |
| `poll-ttlock-arrivals.sh` (`db/poll-ttlock-arrivals.mjs`) | every 20 min | Vercel cron route (Phase 2) |
| `reservation-import.sh` (`db/import-reservation-status.mjs`) | daily, reads a TTLock-pipeline CSV | Phase 3 — likely **partly retired** (Turso is SoT now); confirm what still depends on it |
| `trigger-export.sh` | — | Vercel cron route (Phase 3) |
| `com.cloudflare.cloudflared.plist` | tunnel | Removed at DNS cutover |

---

## 2. ⭐ Split-brain-safe cutover (do this first)

Because payments are live, we must never have requests landing on **both** the Mac (local files) and
Vercel (Turso) with **different** state during DNS propagation. Sequence:

1. **Convert the data layer to Turso/CM-API (Phase 1a/1b) and deploy that to the *Mac* first**
   (`pm2 restart`). Now the Mac reads/writes the *same* Turso the Vercel build will use. Local
   `.data` files are no longer the source of truth.
2. **One-time migrate** existing `.data/*.json` rows into Turso (deposits, processed-payments,
   contacts, extras) so nothing in flight is lost.
3. Deploy the identical code to **Vercel (preview)**. Both endpoints now share one source of truth.
4. Test fully on the `vercel.app` URL (§6).
5. **Then** flip DNS (Charlie, §5). During propagation, whichever host serves a request reads the
   same Turso → no split-brain.
6. After verification, retire the Mac.

---

## 3. Phase 1 — Booking-site → Vercel

1. **Data layer → Turso/CM API** (§1a–1c). Delete `.data` file I/O. Add/confirm CM endpoints:
   - `GET deposit status by ref` (room-reveal gate)
   - `upsert deposit` (webhook) — may already exist via `/api/checkin/upsert`
   - `processed-payment` check+set (idempotency) — **must be atomic** in Turso
   - `findBookingByRef` (portal login), availability/quote reads
2. **cm.ts** → public CM URL + `CM_API_KEY` (§1d).
3. **Vercel project**: create a **new** project for `booking-site` (CM project is `mcconnell-cm`;
   booking-site needs its own). `next start` → Vercel build. Set `maxDuration`/`force-dynamic` where
   already present (deposit + webhook routes are `force-dynamic`).
4. **Env vars** (Vercel, Charlie sets — see §5): live Stripe keys, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_WEBHOOK_SECRET_DEPOSITS`, Turso URL+token, `CHANNEL_MANAGER_URL`, `CM_API_KEY`,
   `NEXT_PUBLIC_SITE_URL`, TTLock creds (if shared).
5. Preview-deploy and run §6 before any DNS change.

## 4. Phase 2 — TTLock door-code polling → cron

Port `db/poll-ttlock-arrivals.mjs` into an auth-guarded route (e.g. `app/api/cron/ttlock-arrivals`)
in the CM, reading arrivals from Turso and calling the TTLock API; update `CrmRecord.arrivedDetected`.
Trigger via the **GitHub Actions** scheduled workflow (same external scheduler as the Beds24 sweep —
Charlie already uses GitHub). ~20-min cadence is fine. Guard with `CRON_SECRET`. Disable the launchd
job only once the cron is verified (don't run both).

## 5. Phase 3 — Email import + exports → cloud

1. **Audit overlap with Beds24 inbound.** The Beds24 webhook + pull already ingest OTA bookings for
   channels on Beds24. Retire whatever `reservation-import.sh` / email import now duplicates.
2. **Remaining email sources** (e.g. channels not on Beds24, Expedia-email): the IMAP watcher is the
   hardest piece to make serverless. Options, in order of preference:
   a. **Cloudflare Email Routing → webhook** (an Email Worker forwards parsed mail to a CM route) —
      fully serverless, no polling.
   b. **Cron IMAP-poll route** — a Vercel route that opens IMAP each run and processes new mail.
   CC to recommend after the overlap audit; may be a near-no-op if Beds24 covers everything.
3. **Exports** (`trigger-export.sh`): port to a CM cron route on the GitHub Actions schedule.

## 6. Verification (before DNS, on the vercel.app URL)

- **Deposit → room reveal, end to end:** start check-in, pay an £80 deposit on a **test PI**, confirm
  the deposits webhook is received by the Vercel URL, status flips in Turso, room number reveals.
  Refund the test charge.
- **Idempotency:** replay the webhook / double-submit — confirm exactly one booking/charge.
- **Portal login** by ref + surname returns the correct (Turso, not stale) booking.
- **Door code** appears on arrival day via the cron route.
- **Inbound booking** flows via Beds24 → CM → shows on the site with the Mac jobs OFF.
- Confirm **no** writes land in any `.data` file anymore.

## 7. Charlie's manual steps (cannot be automated from here)

1. **Vercel**: create the `booking-site` project; add env vars (§3.4); add the custom domain
   `www.streathamrooms.co.uk` (+ apex) once preview tests pass.
2. **Cloudflare DNS**: repoint `streathamrooms.co.uk` from the **tunnel** CNAME to **Vercel**
   (Vercel will show the exact CNAME/A target). Remove the tunnel route.
3. **Stripe Dashboard** (deposits account **and** main account): repoint both webhook endpoints to
   the new Vercel URLs — `/api/webhooks/deposits` and `/api/stripe-webhook` — and update the signing
   secrets in Vercel env if they change.
4. **GitHub**: confirm the Actions scheduled workflow (the external cron trigger) is enabled with
   `CRON_SECRET` as a repo secret.

## 8. Rollback & decommission

- Keep Mac `pm2` (cm + site), `cloudflared`, and the launchd jobs **parked, disabled** for ~1 week.
- Fast rollback: re-enable the tunnel + flip DNS back; the Mac code now also uses Turso, so state is
  consistent either way.
- After a clean week: `pm2 delete`, `cloudflared service uninstall`, `launchctl unload` the plists,
  archive the `.data` files. Mac fully decommissioned.

## 9. Guardrails (repeat)

- Stop before `vercel --prod` (booking-site), DNS, and Stripe webhook repoint — **Charlie confirms**.
- Never run a launchd job and its Vercel cron simultaneously during cutover.
- The processed-payments idempotency check **must be atomic** in Turso (e.g. insert-if-not-exists),
  or a retried webhook can double-charge.
- Keep the `.mjs` CLIs for manual use; don't delete them.
