import { alreadyProcessed, createBookingsFromIntent, Intent } from '@/lib/bookings';
import { PROPERTIES } from '@/lib/properties';

export const dynamic = 'force-dynamic';

export default async function SuccessPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { session_id: sessionId, ref } = searchParams;

  // ---- TEST MODE confirmation (booking already created in /api/checkout) ----
  if (ref) {
    const ids = alreadyProcessed(ref);
    if (!ids) return <Err msg="We couldn't find this booking reference." />;
    return <Confirmed ids={ids} reference={ref} testMode displayName="Streatham Rooms" />;
  }

  // ---- STRIPE: verify payment, then create the booking(s) ----
  if (!sessionId) return <Err msg="Missing payment reference." />;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return <Err msg="Stripe is not configured." />;

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(stripeKey);
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return <Err msg="We couldn't verify your payment session." />;
  }
  if (session.payment_status !== 'paid') {
    return <Err msg="Payment was not completed. You have not been charged a booking — please try again." />;
  }

  const m = session.metadata || {};
  const intent: Intent = {
    kind: (m.kind as 'single' | 'plan') || 'single',
    checkIn: m.checkIn || '',
    checkOut: m.checkOut || '',
    guests: Number(m.guests) || 1,
    guestName: m.guestName || 'Guest',
    email: m.email || session.customer_email || '',
    phone: m.phone || '',
    notes: m.notes || '',
    price: parseFloat(m.price || '0'),
    roomTypeId: m.roomTypeId ? Number(m.roomTypeId) : undefined,
    plan: m.plan || undefined,
    planLabel: m.planLabel || undefined,
  };

  // Use the human-friendly reservation code (also sent to the Stripe webhook /
  // Reservation Data sheet) as the channel-manager channelRef; fall back to
  // the session id for older sessions.
  const displayName = PROPERTIES[m.propertyId || 'streatham']?.displayName ?? 'Streatham Rooms';
  const result = await createBookingsFromIntent(intent, m.reservation_code || session.id);
  if (!result.ok) {
    return (
      <Err
        msg={
          result.soldOut
            ? 'Your payment went through, but the room sold out moments before we could confirm it. We will refund you in full right away — or contact us and we will find you an alternative.'
            : `Your payment went through but the booking could not be recorded automatically (${result.error}). Don't worry — we have your payment reference and will confirm your stay manually.`
        }
        reference={session.id}
      />
    );
  }
  return <Confirmed ids={result.bookingIds} reference={m.reservation_code || session.id} displayName={displayName} />;
}

function Confirmed({ ids, reference, testMode, displayName }: { ids: number[]; reference: string; testMode?: boolean; displayName: string }) {
  return (
    <div className="success-box">
      <h1>Booking confirmed ✓</h1>
      {testMode && <p className="testmode">TEST MODE — no payment was taken.</p>}
      <p>
        Thank you — your stay at {displayName} is booked.{' '}
        {ids.length > 1
          ? `Your room-switch plan was recorded as ${ids.length} linked reservations (one per room). Our team will have each room ready and will help move your things on switch days.`
          : 'We look forward to welcoming you.'}
      </p>
      <p>
        Booking {ids.length > 1 ? 'references' : 'reference'}: <strong>{ids.map((i) => `#${i}`).join(', ')}</strong>
        <br />
        <span className="fine">Payment reference: {reference}</span>
      </p>
      <p className="fine">
        Check-in from 3pm · check-out by 11am · you&apos;ll receive door codes by email/SMS before arrival.
      </p>
      <p>
        Use the <strong>guest portal</strong> — log in with your name and your stay dates — to view
        check-in instructions and add extras: early check-in, parking, laundry and more.
      </p>
      <a className="btn" href="/portal">Open guest portal</a>{' '}
      <a className="btn secondary" href="/">Back to home</a>
    </div>
  );
}

function Err({ msg, reference }: { msg: string; reference?: string }) {
  return (
    <div className="notice error">
      <h2>Something needs attention</h2>
      <p>{msg}</p>
      {reference && <p className="fine">Reference: {reference}</p>}
      <p style={{ marginTop: 10 }}><a href="/">Back to search</a></p>
    </div>
  );
}
