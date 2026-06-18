# Beds24 Go-Live Checklist — 4 properties at once (Seamless held back)

Decisions locked 2026-06-15: activate **Streatham, Tooting, Gassiot, Valnay** together; **hold
Seamless** until its real prices are loaded; rates stay a **manual** `rates:pull`.

Full step detail is in `BEDS24_GOLIVE_PLAN.md`; this is the ordered run-sheet.

## A. Before activation (prep)
- [ ] Resolve the same-day mismatch booking **BDC-5847074342** (Beds24=Gassiot vs hub=Streatham) — confirm where the guest actually is.
- [ ] Check the possible duplicate **BDC-5940266667** in Beds24 (group/multi-room = fine; true duplicate = remove).
- [ ] **Price Check** in Beds24 for the 4 properties (Settings → Channel Manager → Booking.com → Mapping → "Price Data"). Spot-check a few rooms + a peak-season week against your Google Sheet. **Skip Seamless.**
- [ ] Confirm **Seamless's Booking.com channel = Disabled** in Beds24 (and it stays disabled).
- [ ] Note: your 51 Booking.com-ref bookings will import at activation via "Import Existing Bookings" — do **not** add them manually.

## B. Activation — do for each of the 4 properties (per Beds24 wiki Steps 1–9)
- [ ] Booking.com extranet → Account → Connectivity Provider → **Beds24** → tick **both** Reservations and Rates & Availability.
- [ ] Beds24: enter the Booking.com Hotel ID (no blank spaces), Save.
- [ ] **Get Codes** → map rooms; then **Get Codes** → map rate plans (standard rate).
      - At Gassiot, double-check the **Cozy (room 3) vs Vented (room 2)** rooms map to the right BDC codes; if they swap, update those two `beds24RoomId` values (CC-A flagged this).
- [ ] Set **Enable = Enabled** on each room.
- [ ] Click **Price Data** — final check prices/availability are correct.
- [ ] **Activate Connection → Activate Connection Now.**
- [ ] **Import Existing Bookings** (10 at a time, repeat), then click **Update**.
- [ ] **Auto-Replenishment OFF** (Booking.com → Rates & Availability → Calendar settings).
- [ ] Refresh Connection Status → confirm **XML Active** + **Open/Bookable**, no errors.

## C. After activation — flip the automations
- [ ] **Inbound:** configure the Beds24 booking webhook URL (Settings → Properties → Access → Booking Webhook) — URL + secret are in CC-C's handoff note. Beds24 becomes primary inbound for the 4; **keep the email path running for Seamless.**
- [ ] **Outbound:** set `BEDS24_PUSH_DRYRUN=0` in `.env`, run `bash automation/install.sh`, confirm one good live push in the log, then disable the Playwright job:
      `launchctl bootout gui/$(id -u)/com.mcconnell.cm.sync-inventory` (Booking.com only — Expedia stays on the browser path).
- [ ] Verify the **door-code chain** still fires for a Beds24-sourced booking (reservation flows → TTLock code).
- [ ] Re-run `node db/beds24-diff.mjs` — confirm hub-only count drops to near-zero (Seamless will remain).

## D. Seamless — later, separate mini go-live
- [ ] Confirm/fix Seamless prices in the Google Sheet.
- [ ] `npm run rates:pull` (imports Seamless rates to the hub), then re-run the Beds24 initial load for Seamless rooms only.
- [ ] Price Check Seamless in Beds24.
- [ ] Activate Seamless's Booking.com connection (same as section B), enable its outbound push and Beds24 inbound, and drop it from the email-only path.
