import { cookies } from 'next/headers';
import ExtraCard from './ExtraCard';
import { EXTRAS, EARLY_TIMES, LATE_TIMES, timeSlots, parkingExtraFor } from '@/lib/extras';
import { currentProperty } from '@/lib/properties';
import { findBookingByRef, requestsForBooking, verifyToken, PORTAL_COOKIE } from '@/lib/portal';
import { stripeKeyFor } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

const fmt = (d: string) =>
  d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '—';

export default async function PortalPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const ref = verifyToken(cookies().get(PORTAL_COOKIE)?.value);
  const booking = ref ? await findBookingByRef(ref) : null;

  // ---------- not logged in: login form ----------
  if (!booking) {
    return (
      <div className="portal-login">
        <h1>Guest portal</h1>
        <p className="fine" style={{ marginBottom: 18 }}>
          Book extras for your stay — parking, laundry, late check-out and more.
        </p>
        {searchParams.error === '1' && (
          <div className="notice error"><h2>We couldn&apos;t find that booking</h2>
            <p>Use the name the booking was made under, and the exact check-in and check-out dates from your confirmation.</p></div>
        )}
        {searchParams.error === '2' && (
          <div className="notice"><p>Your session expired — please log in again.</p></div>
        )}
        <form className="summary-box" action="/api/portal/login" method="post">
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div className="field">
              <label htmlFor="firstName">First name</label>
              <input id="firstName" name="firstName" required autoComplete="given-name" placeholder="Jane" />
            </div>
            <div className="field">
              <label htmlFor="lastName">Last name</label>
              <input id="lastName" name="lastName" required autoComplete="family-name" placeholder="Smith" />
            </div>
            <div className="field">
              <label htmlFor="checkIn">Check-in date</label>
              <input id="checkIn" name="checkIn" type="date" required />
            </div>
            <div className="field">
              <label htmlFor="checkOut">Check-out date</label>
              <input id="checkOut" name="checkOut" type="date" required />
            </div>
          </div>
          <button className="btn" type="submit" style={{ width: '100%' }}>View my stay</button>
          <p className="fine" style={{ marginTop: 12, textAlign: 'center' }}>
            Use the name and dates exactly as they appear on your booking confirmation.
          </p>
        </form>
      </div>
    );
  }

  // ---------- logged in: extras ----------
  const myRequests = await requestsForBooking(booking.ref);
  const prop = currentProperty();
  const payNow = !!stripeKeyFor(prop.id);

  return (
    <>
      <div className="portal-head">
        <div>
          <h1>Welcome, {booking.guestName.split(' ')[0] || 'guest'} 👋</h1>
          <p className="fine">
            Booking <strong>{booking.ref}</strong>
            {booking.room ? <> · <strong>{booking.room}</strong></> : null} · {fmt(booking.checkIn)} → {fmt(booking.checkOut)}
          </p>
        </div>
        <form action="/api/portal/login" method="post">
          <input type="hidden" name="logout" value="1" />
          <button className="btn secondary" type="submit">Log out</button>
        </form>
      </div>

      {searchParams.error === 'cutoff' && (
        <div className="notice error">
          <h2>Too late for same-day service</h2>
          <p>Same-day extras must be booked and paid before 11am — please pick tomorrow (or later) instead.</p>
        </div>
      )}
      {searchParams.error === 'soldout' && (
        <div className="notice error">
          <h2>Not available for those dates</h2>
          <p>Someone got there first — check the calendar again for remaining dates.</p>
        </div>
      )}
      {searchParams.paid && (
        <div className="notice" style={{ background: 'var(--accent-soft)', borderColor: '#bfe0d2' }}>
          <h2>Payment received ✓</h2><p>Your extra is booked — we&apos;ll confirm the details shortly.</p>
        </div>
      )}

      <section className="summary-box" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.15rem' }}>Check-in instructions</h2>
        <p className="fine">
          Full check-in instructions, your door code, and room number are available at{' '}
          <a href="/checkin">your check-in page</a>.
        </p>
      </section>

      {myRequests.length > 0 && (
        <section className="summary-box" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: '1.15rem' }}>Your requests</h2>
          {myRequests.map((r) => (
            <div className="summary-line" key={r.id}>
              <span>{r.extraName}{r.date ? ` · ${r.date}` : ''}{r.time ? ` · ${r.time}` : ''}{r.nights ? ` · ${r.nights} night${r.nights > 1 ? 's' : ''}` : ''}</span>
              <strong>{r.status === 'paid' ? `paid £${r.price.toFixed(2)} ✓` : r.price > 0 ? `confirmed · £${r.price.toFixed(2)} on arrival` : 'confirmed ✓'}</strong>
            </div>
          ))}
        </section>
      )}

      <h2 className="section-title" style={{ marginTop: 28 }}>Extras &amp; offers</h2>
      <p className="fine" style={{ margin: '-8px 0 16px' }}>
        Make your stay easier — request now, we confirm availability as soon as possible.
      </p>
      <div className="extras-grid">
        {EXTRAS.filter((e) => e.id !== 'early-checkin' && e.id !== 'luggage')
          .map((e) => e.id === 'parking' ? parkingExtraFor(prop.id, prop.checkin.parkingMapsUrl) : e)
          .map((e) => (
          <ExtraCard
            key={e.id}
            extra={e}
            checkIn={booking.checkIn}
            checkOut={booking.checkOut}
            timeSlots={timeSlots()}
            earlyTimes={EARLY_TIMES}
            lateTimes={LATE_TIMES}
            justRequested={searchParams.requested === e.id}
            payNow={payNow}
          />
        ))}
      </div>

      <h2 className="section-title" style={{ marginTop: 36 }}>Guest handbook</h2>

      <section className="summary-box" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 14 }}>🍽 Using the shared kitchen</h2>
        <p style={{ margin: '0 0 12px', lineHeight: 1.7 }}>
          Welcome to the shared kitchen. Mugs, bowls, and spoons are available for all guests to use.
          Please wash, dry, and put away any dishes you use straight after each meal so the space stays
          clean for everyone.
        </p>
        <p style={{ margin: '0 0 12px', lineHeight: 1.7 }}>
          Each guest is given their own dedicated dry food storage and fridge space. Please keep all of
          your food strictly within your assigned area. Anything left outside your designated space will
          be treated as forgotten waste and thrown away.
        </p>
        <p style={{ margin: '0 0 20px', lineHeight: 1.7 }}>
          Optional extras are available for those who&apos;d like them, including pots, pans, additional
          kitchenware, and plateware for lunch and dinner. Just ask if you&apos;d like access to these.
        </p>
        <h3 style={{ fontSize: '1rem', marginBottom: 10 }}>Breakfast</h3>
        <p style={{ margin: 0, lineHeight: 1.7 }}>
          Everything you need for breakfast is provided. You&apos;ll find a bowl, spoon, and mug in your
          own dry food storage space. Help yourself to these each morning, and please wash and return
          them to your storage area once you&apos;re done.
        </p>
      </section>
    </>
  );
}
