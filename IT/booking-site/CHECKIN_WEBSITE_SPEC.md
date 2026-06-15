# Online Check-in Website — Build Spec for the Web Developer

## Goal
A guest-facing online check-in flow for **all properties**. It runs as **three
ordered steps**, each one unlocking the next. Everything the guest enters or does
is captured as structured data so it can later feed our internal CRM. Build it
mobile-first — most guests open this on a phone.

The flow replaces the current "just shows the door code" portal: now the guest
must identify their booking, give us their arrival details, and authorise a
damage deposit before the door code is released.

---

## The three steps (each gates the next)

### Step 1 — Find the reservation
**Purpose:** the guest identifies and confirms their booking — **name and dates only**.

- **Login:** keep the current lookup. Handle "not found" gracefully with a
  friendly retry message.
- Display the guest's **name** and **check-in / check-out dates** (read from the
  live source) for them to confirm.
- **Proceed** button advances to Step 2.

**Produces:** matched booking (reference/id) and a name+dates-confirmed flag.

### Step 2 — Check-in details
**Purpose:** collect contact info for arrival. All fields are **required**; the
guest cannot proceed without them. (We already hold number of guests and country
from the booking, so they are **not** asked here.)

| Field | Required | Type / options |
|---|---|---|
| Expected arrival time | **Yes** | Time picker or set time-bands (check-in is from 3:00pm; allow an "earlier, will enquire" option). |
| Preferred contact method | **Yes** | Choice of **Phone / Email / WhatsApp** … |
| Contact value | **Yes** | …plus the matching number/address for the chosen method (pre-fill from the booking if we have it). |

- Validate all three are present before the **Continue** button enables.
- **Proceed** advances to Step 3.

**Produces:** arrival time, contact method, contact value.

### Step 3 — Check-in instructions & arrival
**Purpose:** give the guest what they need to arrive at and enter the property,
offer extras, and take the damage deposit. The door code is the final reward,
gated as described below.

Show, in this order:
1. **Arrival / location instructions** — address, map links, check-in from 3pm.
2. **Damage deposit (security pre-authorisation)** — a Stripe pre-authorisation
   hold on the guest's card (the card is *authorised*, not charged). Clearly
   explain: it's a hold, released after check-out provided there's no damage.
   Show the amount. **This step is required.**
3. **Room access details.**
4. **Door code** — see gating rule.

#### Door-code gating rule (confirmed, non-negotiable)
The door code is revealed **only when**:
- the **deposit has been authorised** (the hold is in place).

Before this condition is met, show a clear placeholder, e.g. *"Your door code
will appear here once your deposit is authorised."*

**Produces:** extras booked (+ details + paid status), deposit status + amount +
Stripe reference, and (once gated conditions met) the door code shown.

---

## Deposit / payments — technical notes
- The damage deposit must be a Stripe **pre-authorisation** = a PaymentIntent
  created with **manual capture** (the hold), not an immediate charge. We later
  either **release** (cancel) it after check-out, or **capture** part/all of it
  if there's damage — so the build must keep the Stripe PaymentIntent id.
- Tag the deposit PaymentIntent with metadata: `type=deposit`, the booking
  reference, and the amount, so our systems can match it.
- **Hold-expiry handling:** Stripe authorisation holds expire after ~7 days. For
  **stays longer than 6 nights**, take (capture) the deposit **~5 days before
  check-out**; the guest **ticks a box to confirm the deposit will be taken
  during the stay**. For bookings made well in advance, plan accordingly.
- **Build and test in Stripe TEST MODE** — no real holds on real cards during
  development.
- Paid extras also go through Stripe Checkout (existing pattern).

## Where the data should go
Each step's data must end up somewhere our internal CRM can read it. Preferred:
**post it to our channel-manager API** (it's the source of truth; it lives in the
cloud and accepts an API key) as each step completes, rather than only writing to
local files — that way staff see it live. If you're building the website first in
isolation, at minimum make sure **every field below is captured and retrievable**
(e.g. in a database/table or a well-defined JSON payload) so we can wire it to
the CRM afterwards.

Note: number of guests and country come from the existing booking, and a stay
note (e.g. leisure / business) is entered by staff in the CRM — none of these are
collected by this form.

---

## Data dictionary — what this website must produce
Hand this back filled in (field names + format + where it's stored) once built;
we'll map it straight into the CRM.

| Data point | From step | Type | Notes |
|---|---|---|---|
| Booking reference / id | 1 | string/int | The matched reservation |
| Name + dates confirmed? | 1 | yes/no | Guest confirmed details correct |
| Expected arrival time | 2 | time/string | **Required** |
| Preferred contact method | 2 | phone\|email\|whatsapp | **Required** |
| Contact value | 2 | string | Number or email for that method |
| Extras booked | 3 | list | Which extras + any per-extra detail (dates/times) |
| Extra paid status | 3 | per extra | paid / pay-on-arrival / requested |
| Deposit status | 3 | none\|authorised(held)\|captured\|released\|cancelled | |
| Deposit amount | 3 | number | |
| Deposit Stripe reference | 3 | string | PaymentIntent id |
| Door code shown? | 3 | yes/no + timestamp | Only when gated condition met |

---

## Acceptance checklist
1. The three steps run in order; you cannot reach Step 2 without identifying a
   booking, nor Step 3 without the required Step-2 contact fields.
2. Step 1 shows current name + dates from the live source.
3. Step 3 reveals the door code only when the deposit is authorised; otherwise
   the placeholder shows.
4. The damage deposit is a Stripe manual-capture pre-auth (tested in test mode),
   and the PaymentIntent id is retained.
5. Every field in the data dictionary is captured and retrievable.
6. Works cleanly on mobile.
