# For the CMS Agent — how to work without colliding with the Beds24 integration

You're doing CMS feature work on the channel-manager while a separate set of agents migrates the
OTA edges to **Beds24**. This note tells you what's off-limits so the two efforts don't collide.
Read it before you start.

## What's happening right now (so you have context)
- The 4 live properties (streatham, tooting, gassiot, valnay) were **just activated on
  Booking.com via Beds24**. Booking.com pricing/availability is now driven by Beds24.
- Multiple Claude Code instances are mid-flight on Beds24 (`beds24*` branches / `../cm-*`
  worktrees). A **post-activation fix is in progress** (CC-B is re-assigning loaded reservations to
  physical units — some bookings went into Beds24 unassigned, causing Booking.com channel-update
  failures). Until that's confirmed fixed, **availability/booking-allocation logic is volatile.**
- Seamless is **held back** (not live on Beds24 yet).
- Coordination log for the Beds24 agents is `AGENT_HANDOFF.md` (append-only).

## ⚠️ Production reality
The Turso cloud DB is **production** (real bookings, a year of live rates) and Booking.com is now
**live** off it via Beds24. A change that affects availability, rates, the sync queue, or booking
allocation can **propagate to a live OTA**. No destructive DB writes. Test reads are fine.

## DO NOT TOUCH (owned by the Beds24 work)
**Files**
- `lib/beds24.ts`
- `db/beds24-*.mjs` (discover, migrate-beds24-ids, migrate-beds24-shadow, initial-load,
  load-bookings, pull, diff, push)
- `app/api/beds24/**` (the webhook route)
- `automation/install.sh`, `automation/README.md` (Beds24 jobs were just wired in)
- `AGENT_HANDOFF.md` (append-only; don't edit others' entries)
- `roomtypes-bdc-map.csv`, the `BEDS24_*.md` briefs

**Branches / worktrees**
- Branches `beds24`, `beds24-load`, `beds24-inbound`, `beds24-outbound`
- Worktrees `../cm-load`, `../cm-inbound`, `../cm-outbound`
- Work on your own branch off the main CMS line (e.g. `feature/cooking-pack-crm`), **not** off `beds24`.

**Database — do not drop/alter or repurpose**
- New columns `Property.beds24PropId`, `RoomType.beds24RoomId`
- Table `Beds24BookingShadow`
- The `SyncJob` queue and its semantics (the Beds24 push consumes Booking.com-channel rows). Don't
  change its columns or the meaning of `channel`/`field`/`value`.

## HANDLE WITH CARE (shared — coordinate before changing)
These modules feed live channel sync. Editing them can change what Beds24 sends to Booking.com:
- `lib/data.ts` — especially `queueInventorySync`, `pendingSyncJobs`, `createSyncJob`, availability
  helpers, `RateOverride`/`Block` writes
- `lib/availability.ts`, `lib/allocate.ts` — availability + room allocation (CC-B is actively
  fixing unit assignment here; treat as hot)
- `RateOverride`, `Block`, `Booking` (room/unit allocation fields)

If you must change any of these, post a note in `AGENT_HANDOFF.md` first and keep it additive.

## GENERALLY SAFE (still branch separately, still no destructive writes)
- CRM features: `CrmRecord` table and its UI (the cooking-pack / guest-journey work)
- Guest messaging content/templates
- Read-only reporting, dashboards, exports
- Admin UI surfaces that don't read/write availability, rates, or the sync queue
- New tables/routes that don't overlap the names above

## Working rules
1. Branch off the CMS line, not `beds24`. Commit small and often.
2. No destructive writes to the Turso prod DB; additive migrations only.
3. Don't run `automation/install.sh` (it manages the launchd jobs, including the new Beds24 ones).
4. If your task needs a "handle with care" file, flag it in `AGENT_HANDOFF.md` and coordinate.
5. Before merging, rebase on the current CMS branch — not `beds24`.

If your planned task touches anything in "DO NOT TOUCH" or "HANDLE WITH CARE", stop and surface it
to Charlie before proceeding.
