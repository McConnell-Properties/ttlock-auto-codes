# Build brief — Extras scheduling + cleaner daily task list

**Goal:** every extra carries a **service date**, staff can **add/manage extras (with a date) from the multicalendar guest panel**, and the cleaner gets a **daily task list** (check-ins, checkouts, and the day's dated extras) — replacing the legacy system.

**Repo:** `channel-manager` (CMS). This is **CRM-safe-lane** work — it lives on `ExtrasRequest` + a read-only day view + messaging. **Do NOT touch** the `SyncJob` queue, `lib/allocate.ts`, the booking move/allocation logic (it's buggy + Beds24's hot zone), or any Beds24 files. Branch off the CMS line, additive prod migration, stop before `vercel --prod`.

## What already exists (extend, don't rebuild)
- `ExtrasRequest` has `bookingReference, bookingId, extra, **date**, time, nights, price, sourceStatus, taskStatus, …`. So extras already have a date + a task status.
- `extrasTasks()` + the CRM Operations panel already surface extras as tasks. The cleaner view is a date-scoped extension of this.
- The cooking-pack work already maps an extra → a task line ("Set up cooking kit in [room] for [guest] arriving [check-in]").

## 1. Schema — `db/migrate-extras-staff.mjs` (additive, idempotent, cloud+local)
Add to `ExtrasRequest`:
- `billing TEXT NOT NULL DEFAULT 'charge'` — `charge` (guest pays) | `comp` (free / waived)
- `addedBy TEXT NOT NULL DEFAULT 'guest'` — `guest` | `staff`
(`date`, `time`, `price`, `taskStatus` already exist.)

## 2. Staff add/manage extras in the multicalendar guest panel (`app/multical/multical.tsx`)
In the guest-detail popover (when you select a guest), add an **Extras** section, **decoupled from the move/allocation edit**:
- **List** the booking's `ExtrasRequest` rows: type, **date**, status, price (or "Free").
- **Add extra:** choose type from the catalogue (`lib/extras.ts` — early check-in, late checkout, parking, luggage, cooking pack, + an "Other/custom" with a free-text label), **pick the service date** (required), price defaults by type, and a **"Free / comp" toggle** → sets `price = 0`, `billing = 'comp'`. Mark `addedBy = 'staff'`.
- **Edit** the date and **mark `taskStatus`** (pending/in_progress/done).
- Billing: `charge` extras are payable — the guest pays on the **portal** (record as owed; don't generate an emailed link, per the standing decision). `comp` extras are free. Either way the extra still appears as a **cleaner task**.
- Writes go to `ExtrasRequest` only — no `Booking`/allocation writes.

## 3. Service-date semantics per type (so the cleaner sees the right day)
- early check-in → **check-in day**; late checkout → **checkout day**; parking → its selected date(s); cooking pack → **check-in day**; luggage → **drop date**; staff "other" → the picked date.

## 4. Cleaner daily task list
A **per-day** view combining, for a given date:
- **Check-ins** that day → "Prepare room {room} for {guest} (arr {arrivalTime})".
- **Check-outs** that day → "Clean room {room} after {guest}".
- **Every `ExtrasRequest` whose service date = that day** (both `charge` and `comp` — the cleaner acts regardless of billing): type-specific line (reuse the cooking-pack template style), with room, guest, time if any.
Sort by time/room. Each line shows `taskStatus` and can be toggled done.

- **CMS "Today" page** (`app/tasks` or similar) — mobile-friendly, the canonical day list; date picker to view other days.
- **Daily delivery to the cleaner** — each morning, send that day's list. Reuse the existing guest-messaging infra (`lib/messaging.ts` / `lib/email.ts`). **Confirm the channel with Charlie** (email is already wired; WhatsApp/SMS needs a sender). This is what replaces the legacy system.

## 5. Tests (report PASS/FAIL)
1. Migration idempotent cloud+local; new cols present; existing extras read `billing='charge'`, `addedBy='guest'`.
2. Add a **staff** extra with a date + **Free toggle** → stored `price=0, billing='comp', addedBy='staff'`; appears on the booking and in the day view for that date.
3. Add a **billable** staff extra → recorded as owed (guest pays on portal); still shows as a cleaner task.
4. The **Today** view for a date shows that day's check-ins + checkouts + all dated extras; marking one done updates `taskStatus`.
5. Daily message sends the correct day's list to the cleaner (test channel).
6. No writes to `Booking`/allocation; no regression on `/multical`, `/crm`, `/api/*`.

## Open confirm (flag, don't block)
- **Cleaner delivery channel** for the daily message: email (already wired) vs WhatsApp/SMS (needs a sender). Default to email until confirmed.
