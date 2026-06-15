import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentProperty } from '@/lib/properties';
import { findBookingByRef, verifyToken, PORTAL_COOKIE } from '@/lib/portal';
import { getCheckinContact } from '@/lib/checkinContacts';
import CheckinContactForm from './CheckinContactForm';
import CheckinExtrasBlock from './CheckinExtrasBlock';
import { stripeKeyFor } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

const WHATSAPP = '+447491295270';
const SECURED = new Set(['hold_active', 'captured', 'paid', 'succeeded']);

const fmt = (d: string) =>
  d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }) : '—';

const fmtShort = (d: string) =>
  d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }) : '—';

// Deposit due date per stay-length timing table; time is always 3:00 pm.
function depositDueDate(checkIn: string, checkOut: string): string {
  const ci = new Date(checkIn + 'T00:00:00Z');
  const co = new Date(checkOut + 'T00:00:00Z');
  const nights = Math.round((co.getTime() - ci.getTime()) / 86400000);
  let due: Date;
  if (nights <= 1) { due = new Date(ci); due.setUTCDate(due.getUTCDate() - 4); }
  else if (nights === 2) { due = new Date(ci); due.setUTCDate(due.getUTCDate() - 3); }
  else if (nights === 3) { due = new Date(ci); due.setUTCDate(due.getUTCDate() - 2); }
  else if (nights === 4) { due = new Date(ci); due.setUTCDate(due.getUTCDate() - 1); }
  else if (nights === 5) { due = new Date(ci); }
  else { due = new Date(co); due.setUTCDate(due.getUTCDate() - 5); }
  return due.toISOString().slice(0, 10);
}

// Server-side early check-in price (deadline-aware).
function earlyCheckinServerPrice(tier: '1pm' | '2pm', checkInDate: string): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const londonDate = `${get('year')}-${get('month')}-${get('day')}`;
  const londonHour = Number(get('hour'));
  const dl = new Date(checkInDate + 'T00:00:00Z');
  dl.setUTCDate(dl.getUTCDate() - 1);
  const dlStr = dl.toISOString().slice(0, 10);
  const post = londonDate > dlStr || (londonDate === dlStr && londonHour >= 20);
  return tier === '1pm' ? (post ? 15 : 10) : (post ? 10 : 5);
}

type SP = Record<string, string | undefined>;

export default async function CheckinPage({ searchParams }: { searchParams: SP }) {
  const step = Number(searchParams.step) || 1;
  const error = searchParams.error;
  const prop = currentProperty();
  const checkin = prop.checkin;
  const payNow = !!stripeKeyFor(prop.id);

  const ref = verifyToken(cookies().get(PORTAL_COOKIE)?.value);
  const booking = ref ? await findBookingByRef(ref) : null;

  // ── STEP 1: find your booking ───────────────────────────────────────────────
  if (!booking || step === 1) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 6 }}>Online check-in</h1>
        <p className="fine" style={{ marginBottom: 24 }}>
          Enter your name and stay dates to get started.
        </p>
        {error === 'notfound' && (
          <div className="notice error" style={{ marginBottom: 18 }}>
            <h2>Booking not found</h2>
            <p>
              Check that your name and dates match your booking confirmation exactly.
              Need help? Call us on{' '}
              <a href={`tel:${checkin.phone.replace(/\s/g, '')}`}>{checkin.phone}</a>.
            </p>
          </div>
        )}
        {(error === 'missing' || error === 'session') && (
          <div className="notice error" style={{ marginBottom: 18 }}>
            <h2>Something went wrong</h2>
            <p>Please fill in all four fields and try again.</p>
          </div>
        )}
        <form className="summary-box" action="/api/checkin/lookup" method="post">
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div className="field">
              <label htmlFor="firstName">First name *</label>
              <input id="firstName" name="firstName" required autoComplete="given-name" placeholder="Jane" />
            </div>
            <div className="field">
              <label htmlFor="lastName">Last name *</label>
              <input id="lastName" name="lastName" required autoComplete="family-name" placeholder="Smith" />
            </div>
            <div className="field">
              <label htmlFor="checkIn">Check-in date *</label>
              <input id="checkIn" name="checkIn" type="date" required />
            </div>
            <div className="field">
              <label htmlFor="checkOut">Check-out date *</label>
              <input id="checkOut" name="checkOut" type="date" required />
            </div>
          </div>
          <button className="btn" type="submit" style={{ width: '100%' }}>Find my booking →</button>
          <p className="fine" style={{ marginTop: 12, textAlign: 'center' }}>
            Use the name and dates exactly as they appear on your booking confirmation.
          </p>
        </form>
      </div>
    );
  }

  // ── STEP 2: check-in form ───────────────────────────────────────────────────
  if (step === 2) {
    const existing = getCheckinContact(ref!);
    if (existing) redirect('/checkin?step=3');
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 16px' }}>
        <div className="summary-box" style={{ marginBottom: 24, background: '#f0faf4', borderColor: '#bfe0d2' }}>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            <strong>{booking.guestName}</strong> · {fmt(booking.checkIn)} → {fmt(booking.checkOut)}
          </p>
          <p className="fine" style={{ margin: '4px 0 0' }}>Booking confirmed ✓</p>
        </div>

        <h1 style={{ fontSize: '1.4rem', marginBottom: 6 }}>Check in form</h1>
        <p className="fine" style={{ marginBottom: 20 }}>Step 2 of 3 — select at least one contact method to continue.</p>
        {error === 'missing' && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <p>Please select at least one contact method before continuing.</p>
          </div>
        )}
        <div className="summary-box">
          <CheckinContactForm checkInDate={booking.checkIn} checkOutDate={booking.checkOut} />
        </div>
      </div>
    );
  }

  // ── STEP 3: check-in instructions ──────────────────────────────────────────
  const contactRaw = getCheckinContact(ref!);
  if (!contactRaw) redirect('/checkin?step=2');
  const contact = contactRaw!;

  const today = new Date().toISOString().slice(0, 10);
  const showCode = !!booking.lockCode && booking.checkIn <= today;

  const isSecured = SECURED.has(booking.stripeStatus || '');
  const hasDepositLink = !!booking.stripeLink && !isSecured;
  const dueDate = depositDueDate(booking.checkIn, booking.checkOut);
  const dueDateLabel = `${fmtShort(dueDate)} at 3:00 pm`;
  const dueIsToday = dueDate === today;
  const dueIsPast = dueDate < today && !dueIsToday;
  const cardSaved = contact.cardSaved;

  const earlyPrice = contact.earlyCheckin
    ? earlyCheckinServerPrice(contact.earlyCheckin, booking.checkIn)
    : null;
  const showExtrasBlock = !cardSaved && !!(contact.earlyCheckin || contact.parking || contact.luggage);

  return (
    <div style={{ maxWidth: 580, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: '1.4rem', marginBottom: 4 }}>Check-in instructions</h1>
      <p className="fine" style={{ marginBottom: 24 }}>
        Welcome, {booking.guestName.split(' ')[0] || 'guest'} — everything you need for arrival.
      </p>

      {searchParams.paid === 'extras' && (
        <div className="notice" style={{ background: '#f0faf4', borderColor: '#bfe0d2', marginBottom: 20 }}>
          <h2>Payment received ✓</h2>
          <p>Your extras are confirmed — your card is saved for the security deposit.</p>
        </div>
      )}

      {/* ── Block 1: Location ─────────────────────────────────── */}
      <section className="summary-box" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 12 }}>📍 Location</h2>
        <div className="summary-line">
          <span>Address</span>
          <strong style={{ textAlign: 'right' }}>{checkin.addressLines.join(', ')}</strong>
        </div>
        <div className="summary-line">
          <span>Directions</span>
          <span>
            <a href={checkin.googleMaps} target="_blank" rel="noopener">Google Maps</a>
            {' · '}
            <a href={checkin.appleMaps} target="_blank" rel="noopener">Apple Maps</a>
            {checkin.streetView && (
              <>{' · '}<a href={checkin.streetView} target="_blank" rel="noopener">Street View</a></>
            )}
          </span>
        </div>
        <div className="summary-line"><span>Check-in from</span><strong>3:00 pm</strong></div>
        <div className="summary-line"><span>Check-out by</span><strong>11:00 am</strong></div>
        <div className="summary-line">
          <span>Phone</span>
          <strong><a href={`tel:${checkin.phone.replace(/\s/g, '')}`}>{checkin.phone}</a></strong>
        </div>
        <div className="summary-line">
          <span>WhatsApp</span>
          <strong>
            <a href={`https://wa.me/${WHATSAPP.replace(/\D/g, '')}`} target="_blank" rel="noopener">
              {WHATSAPP}
            </a>
          </strong>
        </div>
      </section>

      {/* ── Block 1a: CONFIRM YOUR EXTRAS ────────────────────── */}
      {showExtrasBlock && (
        <section className="summary-box" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 14 }}>CONFIRM YOUR EXTRAS</h2>
          <CheckinExtrasBlock
            earlyCheckin={contact.earlyCheckin}
            earlyCheckinPrice={earlyPrice}
            parkingWanted={contact.parking}
            parkingNote={checkin.parkingNote}
            checkIn={booking.checkIn}
            checkOut={booking.checkOut}
            luggage={contact.luggage ?? null}
          />
        </section>
      )}
      {cardSaved && (contact.earlyCheckin || contact.parking || contact.luggage) && (
        <section className="summary-box" style={{ marginBottom: 20, background: '#f0faf4', borderColor: '#bfe0d2' }}>
          <p style={{ margin: 0 }}>
            <strong>Extras confirmed ✓</strong>
            {contact.earlyCheckin && ` Early check-in at ${contact.earlyCheckin}.`}
            {contact.parking && ' Parking reserved.'}
            {contact.luggage && ` Luggage stored for ${contact.luggage.nights} night${contact.luggage.nights > 1 ? 's' : ''}.`}
          </p>
        </section>
      )}

      {/* ── Block 2: How to open the front door ──────────────── */}
      <section className="summary-box" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 14 }}>🚪 How to open the front door</h2>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/checkin/front_door.jpg"
            alt="Front door smart lock"
            style={{ width: 120, flexShrink: 0, borderRadius: 8, objectFit: 'cover' }}
          />
          <div>
            <p style={{ margin: '0 0 10px', lineHeight: 1.6 }}>
              1) Awaken the device by holding your finger on the <strong>#</strong> key.
            </p>
            {showCode ? (
              <>
                <p style={{ margin: '0 0 10px', lineHeight: 1.6 }}>
                  2) Enter your code:
                </p>
                <div style={{
                  fontFamily: 'monospace', fontWeight: 700, fontSize: '1.6rem',
                  letterSpacing: '0.18em', background: '#f5f5f5', padding: '10px 16px',
                  borderRadius: 8, display: 'inline-block',
                }}>
                  {booking.lockCode}#
                </div>
              </>
            ) : (
              <p style={{ margin: 0, lineHeight: 1.6 }}>
                2) Enter your code then press <strong>#</strong>.
                <br />
                <span className="fine">
                  🔑 Your door code will appear here on your arrival day ({fmtShort(booking.checkIn)}).
                </span>
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Block 3: FIND YOUR ROOM (deposit-gated) ──────────── */}
      <section className="summary-box" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 14 }}>🛏 FIND YOUR ROOM</h2>

        {isSecured ? (
          // Secured — show room number.
          <div style={{ background: '#f0faf4', border: '1px solid #bfe0d2', borderRadius: 10, padding: '14px 16px' }}>
            <p style={{ margin: 0, lineHeight: 1.7 }}>
              ✅ Security deposit received. Your room number is{' '}
              <strong style={{ fontSize: '1.1rem' }}>
                {booking.room ?? "not yet assigned — we’ll confirm it shortly"}
              </strong>.
              <br />
              <span className="fine">
                The £80 hold is released after check-out, provided there&apos;s no damage.
              </span>
            </p>
          </div>
        ) : cardSaved && !dueIsToday && !dueIsPast ? (
          // Card saved via extras checkout — auto-hold in the future.
          <p style={{ lineHeight: 1.7, margin: 0 }}>
            Your room number is hidden until your security deposit is taken.
            <br />
            Your card is securely saved — a refundable <strong>£80</strong> hold will be taken automatically on{' '}
            <strong>{dueDateLabel}</strong>. This is a hold only, not a charge; your card won&apos;t be debited
            unless there&apos;s damage. Your room number appears here once the hold is in place.
          </p>
        ) : dueIsToday ? (
          // Due today.
          <>
            <p style={{ lineHeight: 1.7, margin: '0 0 14px' }}>
              Your room number is hidden until we receive the security deposit.
              <br />
              Your refundable <strong>£80</strong> security hold is due <strong>today</strong>. Authorise it now
              and your room number appears as soon as the hold is in place.
            </p>
            {hasDepositLink && (
              <a href={booking.stripeLink!} className="btn" style={{ display: 'block', textAlign: 'center' }}>
                Authorise deposit →
              </a>
            )}
          </>
        ) : dueIsPast ? (
          // Overdue.
          <>
            <p style={{ lineHeight: 1.7, margin: '0 0 14px' }}>
              We weren&apos;t able to place your <strong>£80</strong> security hold yet. Please authorise it now
              to reveal your room number.
            </p>
            {hasDepositLink && (
              <a href={booking.stripeLink!} className="btn" style={{ display: 'block', textAlign: 'center' }}>
                Authorise deposit →
              </a>
            )}
          </>
        ) : (
          // Not secured, no card saved, due in future.
          <>
            <p style={{ lineHeight: 1.7, margin: '0 0 14px' }}>
              Your room number is hidden until we receive the security deposit.
              <br />
              A refundable <strong>£80</strong> security hold will be taken from your card on{' '}
              <strong>{dueDateLabel}</strong>. This is a hold only — not a charge. Your card will not be debited
              unless there is damage.
            </p>
            {hasDepositLink && (
              <>
                <a href={booking.stripeLink!} className="btn" style={{ display: 'block', textAlign: 'center', marginBottom: 8 }}>
                  Authorise £80 security deposit →
                </a>
                <p className="fine" style={{ textAlign: 'center' }}>
                  Refresh this page after authorising to reveal your room number.
                </p>
              </>
            )}
          </>
        )}
      </section>

      {/* ── Block 4: Opening your room door ──────────────────── */}
      <section className="summary-box" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 14 }}>🔑 Opening your room door</h2>

        {/* TODO @CHARLIE: confirm room-door code is same as front-door code */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/checkin/room_handle.jpg"
            alt="Room door handle"
            style={{ width: '45%', borderRadius: 8, objectFit: 'cover' }}
          />
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 10px', lineHeight: 1.6 }}>
              1) Awaken the device by holding your finger on the <strong>#</strong> key.
            </p>
            {showCode ? (
              <>
                <p style={{ margin: '0 0 10px', lineHeight: 1.6 }}>2) Enter your code:</p>
                <div style={{
                  fontFamily: 'monospace', fontWeight: 700, fontSize: '1.4rem',
                  letterSpacing: '0.14em', background: '#f5f5f5', padding: '10px 14px',
                  borderRadius: 8, display: 'inline-block',
                }}>
                  {booking.lockCode}#
                </div>
              </>
            ) : (
              <p style={{ margin: 0, lineHeight: 1.6 }}>
                2) Enter your code then press <strong>#</strong>.
                <br />
                <span className="fine">Code appears here on arrival day.</span>
              </p>
            )}
          </div>
        </div>

        {/* Red warning */}
        <div style={{
          background: '#fff0f0', border: '1px solid #ffb3b3', borderRadius: 8,
          padding: '12px 14px', marginBottom: 14,
        }}>
          <p style={{ margin: 0, color: '#c00', fontWeight: 600, lineHeight: 1.5 }}>
            ⚠️ Do not push the switch on the inside of your room handle — this disables your code from working.
          </p>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/checkin/backofroomhandle.jpg"
          alt="Back of room door handle — do not press switch"
          style={{ width: '45%', borderRadius: 8, display: 'block', margin: '0 auto' }}
        />
      </section>

      <p className="fine" style={{ textAlign: 'center', marginTop: 8 }}>
        Need anything? WhatsApp or call us:{' '}
        <strong>
          <a href={`https://wa.me/${WHATSAPP.replace(/\D/g, '')}`} target="_blank" rel="noopener">
            {WHATSAPP}
          </a>
        </strong>
      </p>
    </div>
  );
}
