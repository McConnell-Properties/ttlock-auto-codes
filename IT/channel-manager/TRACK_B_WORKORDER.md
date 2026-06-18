# Track B work order — channel-manager / Beds24 / TTLock (parallel CC instance)

**Scope:** the Turso hub, Beds24 integration, TTLock. **Does NOT touch booking-site code** (that's Track A / web dev). **Coordinate via `AGENT_HANDOFF.md`** with **CC-B** (Beds24 mirror + MODIFY + allocation — just fixed) and **CC-C** (inbound OTA matching) so you don't collide in shared files (`lib/availability.ts`, `lib/allocate.ts`, the Beds24 sync scripts).

These are the highest-risk operational gaps. **Do them in order: 1.2 → 1.4 → 2.2.** Anything that pushes to a channel or deletes data must be **dry-run and shown to Charlie first.**

---

## Tier 1.2 — Guests locked out (DO FIRST: door codes / unassigned rooms / missing bookings)
The "guest standing outside, can't get in" exposure.

1. **Install + harden the TTLock issuer.** `TTLOCK_ISSUER_BRIEF.md` is built (first sweep issued 52 codes) but **not live**. Install its standalone launchd job (NOT via `install.sh`). Then: (a) add **inter-call pacing** to stop the bulk `-3003` gateway-busy failures (31 last sweep); (b) add a **"booking within 48h of check-in with no front-door code → alert"** so a persistently offline hub never silently strands a guest; (c) confirm the sweep retries failures + codes new bookings. `--dry-run` first; never mass-delete live codes.
2. **Assign the unassigned rooms → unblocks room codes.** CC-B fixed the allocation self-conflict, so the room auto-assign/backfill (`ROOM_AUTOASSIGN_BRIEF.md`) can now run cleanly. Run it **dry-run → review → apply** to give the ~19 PENDING-ROOM bookings a physical room; the next TTLock sweep then issues their room codes. **Never move an already-assigned booking.**
3. **The ~40 missing Jul–Dec Booking.com reservations.** Reconcile **Beds24 ↔ Turso**: count confirmed BDC reservations in Beds24 vs the hub, find the gap, import the missing ones (additive — match/dedupe by `channelRef`, never double-insert). Coordinate with **CC-C** on *why* they didn't land (inbound gap). Imported ones then need rooms (step 2) + codes (step 1).
4. **Seamless has no smart locks** — not a software fix. Confirm the issuer skips Seamless/Flat (it does) and **surface to Charlie that those properties need a manual guest-access process.** Don't try to auto-code them.

## Tier 1.4 — Double-booking / double-deposit
1. **Dedupe the ~21 duplicate `channelRef` groups.** Discovery-first: list the groups, pick the richest row per ref, **repoint** any `CrmRecord`/`ExtrasRequest`/`LockCode`/allocation to the keeper, then delete the rest. **Show Charlie the proposed merges + before/after counts before deleting anything.** Then add a **`UNIQUE` partial index on `Booking.channelRef` (WHERE channelRef IS NOT NULL)** so duplicates can't recur. This is the root fix for both double-counted availability *and* two £80 holds on one ref.
2. **OTA availability reliability.** The Jun 15–16 sync failures were parked. Availability now flows via **Beds24** (the old scraping path is retired) — verify Beds24 reliably reflects **every** booking (mirror covers direct, inbound covers OTA) so dates close on the channels, and that there's **no parked backlog** of un-pushed availability. Coordinate with CC-B. Overbooking is two guests in one room — this must be solid before/while direct booking is open.

## Tier 2.2 — Stale prices (REVIEW BEFORE PUSHING)
1. **The £16,994 bulk price change (Jun 12) was never reviewed — do NOT push it blind.** Surface exactly what it changed (room types / date ranges / old→new nightly rates / total delta) and **report it to Charlie for sign-off before it propagates to any channel.** A £17k unreviewed swing is far too big to auto-apply — underpricing loses margin, overpricing kills conversion.
2. **Fix the rate-push (hub → Beds24 → OTAs).** It's been failing/parked. Get hub prices pushing to Beds24 reliably (the hub pushes *prices*; Beds24 owns availability) and verify a known change reaches the channels.
3. **Site reads a frozen DB — out of Track-B scope** (it's booking-site code → Track A / web dev: repoint the site off the local `dev.db`/CSV onto the hub API). **Flag it** so it's owned somewhere; Track-B's job is only that the **hub's** prices are current and reach Beds24.

---

## Guardrails (all tiers)
- Production Turso: **additive migrations only.** **Dry-run + show Charlie before any delete (the dedup) or any channel push (the £17k price change).**
- **Don't call the Beds24 API directly** where CC-B's sync owns it — trigger via the agreed flags (`channelDiverged` / drift) and coordinate in `AGENT_HANDOFF.md`.
- Don't edit `lib/availability.ts` / `lib/allocate.ts` without coordinating (CC-B just fixed them).
- **No booking-site code** (Track A).
- Branch off the CMS line; report PASS/FAIL per item; **stop before any `vercel --prod`** for review.
