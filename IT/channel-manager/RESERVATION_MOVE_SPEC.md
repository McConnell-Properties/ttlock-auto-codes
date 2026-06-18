# CMS Feature Spec — Reservation Move & Channel-Divergence Handling

**For:** CMS developer. **Coordinates with:** CC-B (Beds24 mirror), CC-C (inbound), `DIRECT_BOOKING_SPEC.md`. Log progress in `AGENT_HANDOFF.md`.

## Goal
Let staff reassign a reservation to a different room **or property** in the CMS, have that propagate to Beds24 → Booking.com availability (free the old room, block the new one), and correctly handle the case where the booking originated on an OTA — including **undoing the move if the OTA later cancels.**

## Why this is non-trivial
- **Native OTA bookings (Booking.com etc.) are owned by the channel / Beds24** — the hub is downstream. You can't reassign an OTA reservation across properties on the OTA itself.
- But operationally you do move guests (overbooking, maintenance, upgrades), and want availability to follow the guest.
- **Moving a native OTA booking across properties in Beds24 breaks its channel linkage** — so a later OTA cancel/modify may not match cleanly and could leave a **phantom block** (room held for a guest who's cancelled). The marker below is what prevents that.

## Data model — add to `Booking`
- `channelDiverged` BOOLEAN DEFAULT 0 — set when a channel-owned booking's placement is manually changed away from where the channel has it.
- `originRoomTypeId` INTEGER NULL, `originPropertyId` TEXT NULL — the channel's original placement, captured at first move (for reconciliation/undo).
- (Existing, reuse: `beds24Id`, `channelRef`.)

## 1. Move action
When staff reassign a booking to a new room/property:
1. If the booking is channel-owned (`channelRef LIKE 'BDC-%'` etc. / has `beds24Id`) **and** the new placement differs from the channel's: set `channelDiverged=1` and capture `originRoomTypeId`/`originPropertyId` (only on first move).
2. Update the booking's `roomTypeId`/`physicalRoom`/`propertyId`.
3. **Trigger the Beds24 mirror** to push the move — this is CC-B's MODIFY path (`POST /bookings [{id: beds24Id, propertyId, roomId}]`). Result: Beds24 frees the old room, blocks the new one, and propagates to Booking.com for **connected** properties (note: a property only updates on BDC if it's a live Beds24 connection).

## 2. Reconcile when the OTA cancels or modifies a moved booking
When the inbound pipeline receives a **cancel** or **modify** from the OTA, matched by `channelRef`:
- If `channelDiverged=1`, apply it to the **current (moved) booking**, not the origin:
  - **Cancel** → cancel the booking → frees the room it *currently* occupies. (The origin room was already freed at move time, so the end state is both free.) Clear `channelDiverged`. **This is the "undo" Charlie described** — without it, the broken linkage means the cancellation could miss the moved booking and leave Streatham room 8 blocked forever.
  - **Modify (dates)** → apply to the current placement.
- **Critical:** matching must key on `channelRef` and must **not** require the property to match (we deliberately moved it). So a broken-linkage cancellation still finds and frees the moved booking.

## 3. Convert OTA → Direct — ❌ NOT BUILDING (Charlie's decision, 2026-06)
> **Removed from scope. Do not build any convert-to-direct flow, marker, or auto-rebook.** The platform-terms caution below is exactly why — kept here as the record of the reasoning. Ignore this section when building.

Charlie's third option, as a deliberate feature: turn a commissionable OTA booking into a direct one (saves the ~15% OTA commission).
- Flow: staff negotiate a free cancellation with the guest on the OTA, then rebook direct.
- Mechanism: mark the OTA booking `convertingToDirect=1`. When the OTA cancellation arrives, **don't just free the room** — create a matching **direct** booking for the same stay/room/guest (per `DIRECT_BOOKING_SPEC.md`), so the room stays held through the transition (no window where it looks available and could be double-sold).
- **Decision for Charlie:** on the OTA cancellation, auto-create the direct booking, or prompt staff to confirm first? *Recommend prompt-to-confirm initially, automate once trusted.*
- **⚠️ Platform-terms caution — do NOT automate solicitation.** Actively encouraging a guest to cancel on the OTA and rebook direct to avoid commission generally breaches Booking.com's partner terms (anti-circumvention / parity), and at scale risks penalties or delisting. Build this only as a **manual, staff-initiated, case-by-case** tool that handles a cancellation the guest has *independently* chosen — never an automated workflow that nudges OTA guests to cancel. Charlie to verify against the Booking.com partner agreement before using. This is a business/compliance decision, not a default-on feature.

## Coordination / boundaries
- **CC-B** owns pushing moves to Beds24 (the MODIFY path in `beds24-sync-bookings.mjs` — the prerequisite; CC-B already sketched it: detect `roomTypeId`/`checkIn`/`checkOut` drift vs Beds24, re-POST). The CMS **triggers** it on booking write; the CMS does **not** call the Beds24 API directly.
- **CC-C** owns inbound — OTA cancels/modifies must match by `channelRef` regardless of property and route to §2.
- Don't break the shared availability/allocation modules (`lib/availability.ts`, `lib/allocate.ts`) — those are CC-B's hot files; coordinate via `AGENT_HANDOFF.md`.

## Open decisions for Charlie — RESOLVED (2026-06)
1. OTA cancel of a moved booking → **auto-apply** the cancel to the moved booking (free its current room, clear the marker). No staff prompt.
2. Convert-to-direct → **not building** (§3 removed).
3. Cross-property moves → allowed, but **warn/confirm specifically for channel-owned (OTA) bookings**.
