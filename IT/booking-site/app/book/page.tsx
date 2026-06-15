import Gallery from '@/components/Gallery';
import { contentByPhysicalRoom } from '@/lib/content';
import { getAvailability } from '@/lib/cm';
import { currentProperty } from '@/lib/properties';
import { roomPhotos } from '@/lib/photos';
import { stripeKeyFor } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | undefined>;

const fmt = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export default async function BookPage({ searchParams }: { searchParams: Search }) {
  const { checkIn = '', checkOut = '', plan, planLabel, roomTypeId } = searchParams;
  const guests = Math.max(1, Number(searchParams.guests) || 1);
  const price = parseFloat(searchParams.price || '0');
  const base = parseFloat(searchParams.base || '0');
  const prop = currentProperty();
  const testMode = !stripeKeyFor(prop.id);

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(checkIn) || !dateRe.test(checkOut) || checkOut <= checkIn || (!plan && !roomTypeId)) {
    return <div className="notice error"><h2>Missing booking details</h2><p>Please start from the <a href="/">search page</a>.</p></div>;
  }

  // Re-validate live availability for single-room bookings.
  let roomName = '';
  let stillAvailable = true;
  if (roomTypeId) {
    try {
      const rows = await getAvailability(checkIn, checkOut, prop.id);
      const row = rows.find((r) => r.roomTypeId === Number(roomTypeId));
      roomName = row?.roomTypeName || '';
      stillAvailable = !!row && row.available > 0;
    } catch { /* let the checkout step catch system issues */ }
  }
  const content = roomName ? prop.rooms.find((r) => r.name === roomName) : undefined;
  const photos = content ? roomPhotos(content.slug) : [];

  const segs = (plan || '')
    .split('|')
    .map((s) => s.split(':'))
    .filter((p) => p.length === 4)
    .map(([room, start, end, p]) => ({ room, start, end, price: parseFloat(p) || 0 }));

  const nights = Math.round((+new Date(checkOut) - +new Date(checkIn)) / 86400000);

  if (roomTypeId && !stillAvailable) {
    return (
      <div className="notice error">
        <h2>This room just sold out for your dates</h2>
        <p>Someone beat you to it. <a href={`/search?checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`}>Search again</a> — we may have other rooms or a room-switch plan.</p>
      </div>
    );
  }

  return (
    <div className="two-col">
      <div>
        <h1 style={{ fontSize: '1.4rem' }}>Your details</h1>
        {testMode && <p className="testmode">TEST MODE — no Stripe key configured. The booking will be created without taking payment.</p>}
        <form className="summary-box" action="/api/checkout" method="post">
          <input type="hidden" name="checkIn" value={checkIn} />
          <input type="hidden" name="checkOut" value={checkOut} />
          <input type="hidden" name="guests" value={guests} />
          <input type="hidden" name="price" value={price} />
          {roomTypeId && <input type="hidden" name="roomTypeId" value={roomTypeId} />}
          {plan && <input type="hidden" name="plan" value={plan} />}
          {planLabel && <input type="hidden" name="planLabel" value={planLabel} />}
          <div className="form-grid">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="guestName">Full name *</label>
              <input id="guestName" name="guestName" required minLength={2} placeholder="Jane Smith" />
            </div>
            <div className="field">
              <label htmlFor="email">Email *</label>
              <input id="email" name="email" type="email" required placeholder="jane@example.com" />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" type="tel" placeholder="+44 7700 900000" />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="notes">Requests (arrival time, allergies, …)</label>
              <input id="notes" name="notes" maxLength={300} placeholder="e.g. arriving after 9pm" />
            </div>
          </div>
          <p className="fine" style={{ margin: '12px 0' }}>
            Free cancellation up to 48 hours before check-in. By booking you agree to our house rules
            (no smoking, quiet hours 10pm–8am).
          </p>
          <button className="btn" type="submit" style={{ width: '100%' }}>
            {testMode ? `Confirm booking — £${price.toFixed(2)}` : `Pay £${price.toFixed(2)} and book`}
          </button>
          {!testMode && (
            <p className="secure-note">🔒 Secure payment by Stripe — we never see your card details</p>
          )}
        </form>
      </div>

      <aside className="summary-box">
        <h2 style={{ fontSize: '1.1rem' }}>Booking summary</h2>
        {photos.length > 0 && (
          <div style={{ borderRadius: 10, overflow: 'hidden', marginBottom: 12, height: 180 }}>
            <Gallery photos={photos} alt={content?.headline || 'Your room'} />
          </div>
        )}
        <div className="summary-line"><span>Check-in</span><strong>{fmt(checkIn)}</strong></div>
        <div className="summary-line"><span>Check-out</span><strong>{fmt(checkOut)}</strong></div>
        <div className="summary-line"><span>Guests</span><strong>{guests}</strong></div>
        <div className="summary-line"><span>Nights</span><strong>{nights}</strong></div>
        {content && <div className="summary-line"><span>Room</span><strong>{content.headline}</strong></div>}
        {segs.length > 0 && (
          <>
            <div className="summary-line"><span>Plan</span><strong>{segs.length} rooms, {segs.length - 1} switch{segs.length > 2 ? 'es' : ''}</strong></div>
            <ul className="segments">
              {segs.map((s, i) => {
                const c = contentByPhysicalRoom(s.room);
                return <li key={i}>{fmt(s.start).replace(/ \d{4}$/, '')} → {fmt(s.end).replace(/ \d{4}$/, '')}: {c?.headline || `Room ${s.room}`}</li>;
              })}
            </ul>
            <p className="fine">We&apos;ll move your luggage to the next room on switch day — just leave it packed by 11am.</p>
          </>
        )}
        {base > price && <div className="summary-line"><span>Standard price</span><span className="strike">£{base.toFixed(2)}</span></div>}
        {base > price && <div className="summary-line"><span>Long-stay discount</span><span className="save">−£{(base - price).toFixed(2)}</span></div>}
        <div className="summary-line total"><span>Total</span><span>£{price.toFixed(2)}</span></div>
      </aside>
    </div>
  );
}
