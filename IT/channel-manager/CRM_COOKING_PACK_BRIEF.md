# Build brief — CRM handling for new extra type `cooking-pack`

The booking site now offers a **cooking pack** extra. It already flows into the CMS via the existing check-in ingestion (`upsertCheckin` → `ExtrasRequest`, stored with `extra = 'cooking-pack'`). **No ingestion or schema change is needed.** This brief is only the CRM display/task layer.

**Repo:** this one, `channel-manager`. The relevant code already exists:
- `lib/data.ts` → `extrasTasks()` (joins each extra to its booking: `guestName`, `propertyName`, `physicalRoom`, `checkIn`, `checkOut`) and `ExtrasTask` type.
- `app/crm/board.tsx` → section "5 · Operations — extras", which currently renders extras **generically** (shows the raw `extra` string + a `taskStatus` dropdown). There is no extra-id→type map yet — you're adding the first one.

---

## Facts about `cooking-pack` (from the booking site)
- `extra` value: **`cooking-pack`** — a brand-new category; no existing type maps to it.
- `date` and `time` are **always null** for this extra. Any logic that assumes a non-null date (for "When" display, sorting, task/calendar creation) must handle null gracefully and **derive the date from the booking** (`checkIn`) instead.
- `nights` = stay duration, **informational only**. Do **not** recompute price from it.
- `price` = the Stripe charge (£15/week, pre-calculated). The separate **£25 deposit is collected offline on arrival** — there is no deposit field; don't expect one.
- Status flow: `sourceStatus` `pending-payment` → `paid` (same as other paid extras). **The CRM should only action it once `sourceStatus = 'paid'`.** Treat `paid` as final.
- No inventory/calendar dimension — no availability check, no slot to block.

---

## What to build

### 1. Extra-type metadata map (`lib/data.ts` or a small `lib/extras.ts`)
Add a lookup keyed by the `extra` id that gives each a human label and an optional task template. Seed it with the known ids so the panel stops showing raw slugs:
```ts
export const EXTRA_TYPES: Record<string, { label: string; task?: (e: ExtrasTask) => string }> = {
  'early-checkin': { label: 'Early check-in' },
  'parking':       { label: 'Parking' },
  'luggage':       { label: 'Luggage drop-off' },
  'cooking-pack':  {
    label: 'Cooking pack',
    task: (e) => `Set up cooking kit in ${e.physicalRoom ?? 'room'} for ${e.guestName ?? 'guest'} arriving ${e.checkIn ?? 'check-in'}`,
  },
};
```
Unknown ids fall back to the raw `extra` string (don't crash on new ones).

### 2. Render it in the extras panel (`app/crm/board.tsx`)
- Show `EXTRA_TYPES[e.extra]?.label ?? e.extra` instead of the raw slug.
- For rows with a `task` template (cooking-pack), show the generated task line, e.g. as a sub-line under the label: *"Set up cooking kit in 4 for J. Smith arriving 2026-06-20"*. Room + guest + check-in come from the booking join already in `ExtrasTask` — **not** from the extras row (which has null date).
- **"When" column:** when `e.date` is null, fall back to the booking `checkIn` (label it as the arrival/stay, not a service slot). Don't render an empty/`null` cell.
- Optional, helpful: for cooking-pack show a muted note "£25 deposit on arrival (offline)" so staff remember to collect it — informational only, there's no field for it.

### 3. Only action **paid** extras
Currently `extrasTasks()` filters by `taskStatus` only, so unpaid (`pending-payment`) requests can appear. Gate on payment: **suppress rows where `sourceStatus = 'pending-payment'`** (only surface `paid`, or `confirmed`/£0 test rows). Apply this to the query (`extrasTasks`) so it's consistent for all extras, not just cooking-pack. Keep `taskStatus` (staff workflow: pending/in_progress/done/cancelled) separate from `sourceStatus` (payment).

### 4. Sorting / null-date safety
`extrasTasks()` already orders by `COALESCE(e.date, b.checkIn)` — confirm cooking-pack (null date) sorts by the booking check-in and doesn't error anywhere downstream.

---

## Test checklist (report PASS/FAIL)
1. A `cooking-pack` ExtrasRequest with `date=null`, `sourceStatus='paid'` renders in the panel with label "Cooking pack" and the generated task line showing the correct room/guest/check-in.
2. The same row with `sourceStatus='pending-payment'` is **suppressed** (not actioned) until paid.
3. No crash/empty-cell on the null `date` — "When" falls back to check-in.
4. Existing extras (early-checkin/parking/luggage) still render (now with friendly labels) — no regression.
5. `nights` is shown but never used to recompute price.

No migration, no Stripe calls, no calendar/inventory. Build on a branch and stop for review before `vercel --prod`.
