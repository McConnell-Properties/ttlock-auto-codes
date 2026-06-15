# Online Check-in Website — Build Spec (Phase C3)  [REV 2026-06-13]

Authoritative spec for the guest check-in flow at `/checkin`. Mobile-first.
Applies to all properties (branded per property). Replaces the old "just shows
the door code" portal. Each step's data is captured for the CRM (POST to the
channel-manager API where possible; otherwise persist + retrievable).

> GATING (confirmed): the **bedroom room NUMBER** is gated behind the security
> deposit. The smart-lock **codes** are shown as instructions (see Step 3
> blocks). Door/room codes come from the TTLock `checkin_data.json`.

---

## Step 1 — Find the reservation
- Identify the guest by **first name + last name + check-in date + check-out
  date** (4 inputs). **No booking-reference lookup.** Handle "not found" with a
  friendly retry.
- Match against the LIVE source (`checkin_data.json` / channel-manager). The
  4-field combo should be unique in practice; if it somehow matches more than
  one booking, show a "please contact us" message (do NOT fall back to booking
  ref — Charlie ruled it out).
- Display the matched guest's **first + last name and check-in / check-out
  dates** for confirmation.
- Proceed → Step 2. Produces: matched booking (id), confirmed flag.

## Step 2 — "Check in form"
Title: **Check in form**.
1. **Contact methods** — multiple selectable boxes; the guest must select **at
   least one** to continue (phone / email / WhatsApp / …), with the matching
   value pre-filled from the booking where known.
2. **Early check-in offers** (selectable add-ons, dynamic price with countdown):
   - **"1pm check-in for £10"** — smaller text: "offer ends [countdown to 8:00pm
     the previous day], then £15".
   - **"2pm check-in for £5"** — smaller text: "offer ends [countdown to 8:00pm
     the previous day], then £10".
   - Countdown targets **20:00 the day before check-in**. After it passes, show
     the higher price (£15 / £10) and charge that.
3. **Parking button** — same component/behaviour as the existing guest portal.
- Validate ≥1 contact method before Continue enables. Proceed → Step 3.
- Produces: selected contact method(s) + value(s), early-check-in choice (which
  tier, price paid), parking choice.
- (Note: number of guests + country come from the booking; not asked here.)

## Step 3 — Check-in instructions & arrival
Render these blocks in order:

**Block 1 — 📍 Location** (per property; Streatham example):
- Address: 116 Streatham Road, Mitcham, CR4 2AE
- Directions: Google Maps + Apple Maps links
- Check-in from 3:00 pm · Check-out by 11:00 am
- Phone: +44 7418 640119 (tel: link)
- WhatsApp: **+447491295270** (same across ALL properties)
- Pull address/phone/maps per-property from `lib/checkinContent.ts` /
  `property-contact-info.md`; WhatsApp is the single shared number above.

**Block 1a — "CONFIRM YOUR EXTRAS"** (only shown if early check-in and/or
parking selected in Step 2). The guest **pays here on the Step 3 page**:
- Show ONE Stripe pay button **combining both selected prices** (early check-in +
  parking) into a single payment, using the per-property Stripe key.
- Set **`setup_future_usage: 'off_session'`** on that PaymentIntent so the card
  is saved for the later £80 security-deposit hold (so the deposit can be taken
  automatically without asking the guest again).
- **Parking description (per property):**
  - **Streatham** — parking is **on site**.
  - **Gassiot / Tooting / Valnay** — parking is **off site, at the Streatham Road
    location**.
  - All of the above: the space is **behind 2 private gates** and **best suited
    to smaller cars**.
  - **Seamless** (Norwich) — parking not specified; ⚠️ @CHARLIE confirm (omit
    parking for Seamless until known).

**Block 2 — "🚪 How to open the front door"**:
- Image on the LEFT: `front_door.jpg` (see assets).
- Text on the RIGHT:
  "1) Awaken the device by holding finger on the hash key
   2) Enter Your code: **[CODE]#**"
- **Remove** any "We'll also send it to you directly." line.
- [CODE] = the guest's front-door smart-lock code from `checkin_data.json`.

**Block 3 — "🛏 FIND YOUR ROOM"** (deposit-gated):
- Room number is hidden until the deposit is secured (`stripeStatus` ∈
  {`hold_active`,`captured`,`paid`,`succeeded`}); then reveal the **room number**.
- Deposit = the EXISTING pipeline deposit (`run_reservation_pipeline.py`),
  **£80 × number of rooms** (a refundable HOLD), surfaced via the booking's
  `stripeLink` / `stripeStatus` in `checkin_data.json`. The site does NOT create
  a new PaymentIntent; the pipeline owns capture/release.
- **Remove** the old line: "Your deposit link is on its way by email. Once
  authorised, refresh this page to reveal your room number."
- **Deposit-taken date `D`** is computed from the stay length, taken at **3:00 pm**
  (holds expire after ~7 days):

  | Length of stay | Deposit taken (`D`) |
  |---|---|
  | 1 night | 4 days before check-in |
  | 2 nights | 3 days before check-in |
  | 3 nights | 2 days before check-in |
  | 4 nights | 1 day before check-in |
  | 5 nights | on the day of check-in |
  | 6+ nights | 5 days before **check-out** (mid-stay) |

### Block 3 — message variations (use these exact texts)
Pick by deposit state + whether a card is already saved (off_session) + `D` vs now:

- **Deposit secured** (`stripeStatus` in the secured set):
  > ✅ Security deposit received. Your room number is **[ROOM]**.
  > The £80 hold is released after check-out, provided there's no damage.

- **Not secured · card already saved** (guest paid extras with off_session) · `D` in future:
  > Your room number is hidden until your security deposit is taken.
  > Your card is securely saved — a refundable **£80** hold will be taken
  > automatically on **[D] at 3:00 pm**. This is a hold only, not a charge; your
  > card won't be debited unless there's damage. Your room number appears here
  > once the hold is in place.

- **Not secured · no card saved · `D` in future:**
  > Your room number is hidden until we receive the security deposit.
  > A refundable **£80** security hold will be taken from your card on **[D] at
  > 3:00 pm**. This is a hold only — not a charge. Your card will not be debited
  > unless there is damage.
  > [Authorise deposit] ← Stripe `stripeLink`

- **Not secured · `D` is today:**
  > Your room number is hidden until we receive the security deposit.
  > Your refundable **£80** security hold is due **today**. Authorise it now and
  > your room number appears as soon as the hold is in place.
  > [Authorise deposit]

- **Not secured · `D` has passed (hold not yet placed / failed):**
  > We weren't able to place your **£80** security hold yet. Please authorise it
  > now to reveal your room number.
  > [Authorise deposit]

(The "day-n before check-in" vs "day-n before check-out" wording is just whichever
rule produced `D`; always display the concrete date+time, not the offset.)

**Block 4 — "🔑 Opening your room door"**:
- Image: `room_handle.jpg` (see assets) — render it **as large as the bottom
  image** (equal/large size, not a small thumbnail).
- Text:
  "1) Awaken the device by holding finger on the hash key
   2) Enter Your code: **[CODE]#**"
- Then, in **red**: "Do not push the switch on the inside of your room handle,
  this disables your code from working" — with image `backofroomhandle.jpg`.
- ⚠️ @CHARLIE/@CODE confirm: is the room-door [CODE] the same code as the front
  door, or a separate per-room code in `checkin_data.json`?

**Block 5 — "🍽 Using the shared kitchen"** (Step 3 info block; shared copy
across properties — ⚠️ @CHARLIE confirm whether to hide for private-kitchen
rooms e.g. the Streatham luxury apartment). Use this exact text:

> **Using the Shared Kitchen**
> Welcome to the shared kitchen. Mugs, bowls, and spoons are available for all
> guests to use. Please wash, dry, and put away any dishes you use straight after
> each meal so the space stays clean for everyone.
> Each guest is given their own dedicated dry food storage and fridge space.
> Please keep all of your food strictly within your assigned area. Anything left
> outside your designated space will be treated as forgotten waste and thrown
> away.
> Optional extras are available for those who'd like them, including pots, pans,
> additional kitchenware, and plateware for lunch and dinner. Just ask if you'd
> like access to these.
>
> **Breakfast**
> Everything you need for breakfast is provided. You'll find a bowl, spoon, and
> mug in your own dry food storage space. Help yourself to these each morning,
> and please wash and return them to your storage area once you're done.

---

## Assets (images) — @CODE must copy from the Mac into the repo
@COWORK has no Mac access. Copy these into `public/checkin/`:
- `/Users/charliemcconnell/Documents/Career/McConnell Enterprises/Operations/Check in/front_door.jpg` → Block 2
- `/Users/charliemcconnell/Documents/Career/McConnell Enterprises/Operations/Check in/room handle.jpg` → Block 4
- `/Users/charliemcconnell/Documents/Career/McConnell Enterprises/Operations/Check in/backofroomhandle.jpg` → Block 4 (red warning)
- Already copied: `front-door-lock.jpg`. ⚠️ This REV uses `front_door.jpg` + a
  text code in Block 2 instead of overlaying the code on the lock image. @CODE:
  reconcile — likely the lock-image overlay is now redundant; confirm before
  removing.

## Guest portal cleanup (existing `/portal`)
- **Remove early check-in** from the guest portal.
- **Remove all check-in information** from the guest portal — it now lives only
  in `/checkin`. (Keep whatever non-check-in portal function remains, e.g.
  other extras, unless told otherwise — @CHARLIE confirm scope of removal.)

## Data dictionary (hand back filled in)
| Data point | Step | Type | Notes |
|---|---|---|---|
| Booking reference / id | 1 | string/int | matched reservation |
| First + last name | 1 | string | lookup input + confirmed |
| Check-in date | 1 | date | lookup input + confirmed |
| Check-out date | 1 | date | lookup input + confirmed |
| Confirmed correct? | 1 | yes/no | |
| Contact method(s) | 2 | list of phone\|email\|whatsapp | ≥1 required |
| Contact value(s) | 2 | string(s) | per chosen method |
| Early check-in choice | 2 | none\|1pm\|2pm | + price paid (tier/after-deadline) |
| Parking choice | 2 | bool + detail | as per portal |
| Extras paid status | 3 | per extra | paid / pay-on-arrival / requested |
| Deposit status | 3 | from pipeline `stripeStatus` | secured set gates room no. |
| Deposit amount | 3 | number | £80 × rooms |
| Deposit due date/time | 3 | datetime | computed from timing table |
| Room number shown? | 3 | yes/no + timestamp | only when deposit secured |

## Acceptance checklist
- Steps run in order; can't reach Step 2 without a matched booking, nor Step 3
  without ≥1 contact method.
- Step 1 matches on first+last+check-in+check-out date from the LIVE source.
- Early check-in shows correct price + live countdown to 20:00 the prior day,
  switching to the higher price after.
- Block 3 hides the room number until `stripeStatus` is secured, and shows the
  deposit-due date/time per the timing table.
- Blocks 2 & 4 show the correct images + code instructions; the red room-handle
  warning is present.
- Early check-in + all check-in info removed from `/portal`.
- Works cleanly on mobile.

## OPEN for @CHARLIE
- Room-door code: same as front-door code or per-room?
- Scope of `/portal` removal (everything check-in, or the whole portal?).
- Deposit amount confirmed £80 × rooms (from pipeline).
