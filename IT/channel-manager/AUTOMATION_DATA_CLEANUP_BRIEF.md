# Build brief — Automation tidy-up + data hygiene

Several small, independent items in `channel-manager` (+ pipeline read for context). Production DB: **additive / parameterised updates only, no destructive writes; Stripe untouched.**

## 1. Inventory-only sync consumers
`node db/sync-cli.mjs list booking.com` now returns **counts** by default (the price blob moved behind `--type`). Audit anything that still calls the bare `list` and switch it to `list booking.com --type inventory`: check `automation/` scripts, any helper, and the README/docs.
(The Cowork scheduled tasks `ota-sync-queue-push` and the BDC push prompt are updated **separately by DESKTOP** — not your job.)

## 2. Gmail auto-import — verify
`db/poll-booking-emails.mjs` and `db/watch-booking-emails.mjs` run via launchd. Confirm they correctly import OTA **reservation and cancellation** emails into the cloud `Booking` table (cancellations must flip `status`). Report what works and any gaps; fix obvious breaks. Don't rebuild if it's working.

## 3. Expedia push + mapping gap
Seamless Stays has `expediaHotelId = null` (the other four are set). Determine whether Expedia inventory/price push is needed for Seamless; if so, the id must be added on the Properties page (human input). Report the gap — the Expedia recipe is in `IT/expedia-extranet-recipes.md`.

## 4. Placeholder bookings (data hygiene)
Bookings **639–643** are `"Imported — Room X"` (`channel=import`, no `channelRef`), from the old-sheet migration. They block availability correctly but carry placeholder names. Real guest names + `channelRef`s must come from the BDC/Expedia extranet — **Charlie/human input; do not invent values.**
Build a tiny parameterised helper/script to update a booking's `guestName` + `channelRef` by id (safe, idempotent), and **list the 5 with what's needed** so Charlie can supply the values.

## Tests (report PASS/FAIL)
- No consumer still calls bare `list booking.com` expecting job arrays.
- Gmail import: a sample reservation email imports; a cancellation email flips status (or report the gap).
- The placeholder-booking updater runs against a test id and updates only the two fields, parameterised.
