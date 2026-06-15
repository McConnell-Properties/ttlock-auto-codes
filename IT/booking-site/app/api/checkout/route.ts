import { NextRequest, NextResponse } from 'next/server';
import { createBookingsFromIntent, Intent } from '@/lib/bookings';
import { propertyForRequest } from '@/lib/properties';
import { stripeKeyFor } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

function siteUrl(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:4100';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

function intentFromForm(form: FormData): Intent | { error: string } {
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const checkIn = get('checkIn'), checkOut = get('checkOut');
  const guestName = get('guestName'), email = get('email');
  const price = parseFloat(get('price'));
  const roomTypeId = get('roomTypeId'), plan = get('plan');
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(checkIn) || !dateRe.test(checkOut) || checkOut <= checkIn) return { error: 'invalid dates' };
  if (!guestName || guestName.length < 2) return { error: 'name is required' };
  if (!email) return { error: 'email is required' };
  if (!(price > 0)) return { error: 'invalid price' };
  if (!roomTypeId && !plan) return { error: 'no room selected' };
  return {
    kind: plan ? 'plan' : 'single',
    checkIn, checkOut,
    guests: Math.max(1, Number(get('guests')) || 1),
    guestName, email,
    phone: get('phone'),
    notes: get('notes').slice(0, 300),
    price,
    roomTypeId: roomTypeId ? Number(roomTypeId) : undefined,
    plan: plan || undefined,
    planLabel: get('planLabel').slice(0, 400) || undefined,
  };
}

export async function POST(req: NextRequest) {
  const SITE = siteUrl(req);
  const prop = propertyForRequest(req);
  const form = await req.formData();
  const intent = intentFromForm(form);
  if ('error' in intent) {
    return NextResponse.redirect(`${SITE}/?error=${encodeURIComponent(intent.error)}`, 303);
  }

  const stripeKey = stripeKeyFor(prop.id);

  // ---- TEST MODE: no Stripe key — create the booking immediately ----
  if (!stripeKey) {
    const ref = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const result = await createBookingsFromIntent(intent, ref);
    if (!result.ok) {
      const back = `${SITE}/search?checkIn=${intent.checkIn}&checkOut=${intent.checkOut}&guests=${intent.guests}&bookError=${encodeURIComponent(result.error)}`;
      return NextResponse.redirect(back, 303);
    }
    return NextResponse.redirect(`${SITE}/success?ref=${ref}`, 303);
  }

  // ---- STRIPE: create a Checkout Session; booking is created on /success
  // after the session is verified as paid. ----
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(stripeKey);
  // Booking reference: used as channel-manager channelRef AND sent as
  // metadata.reservation_code so the existing Stripe webhook (Apps Script →
  // Reservation Data sheet) can match this payment by reference.
  const bookingRef = `DIRECT-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const nights = Math.round((+new Date(intent.checkOut) - +new Date(intent.checkIn)) / 86400000);
  const description = intent.kind === 'plan'
    ? `Room-switch stay ${intent.checkIn} → ${intent.checkOut} (${nights} nights)`
    : `Stay ${intent.checkIn} → ${intent.checkOut} (${nights} nights)`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: intent.email,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: Math.round(intent.price * 100),
        product_data: { name: `${prop.displayName} — direct booking`, description },
      },
    }],
    metadata: {
      reservation_code: bookingRef,
      propertyId: prop.id,
      kind: intent.kind,
      checkIn: intent.checkIn,
      checkOut: intent.checkOut,
      guests: String(intent.guests),
      guestName: intent.guestName,
      email: intent.email,
      phone: intent.phone,
      notes: intent.notes,
      price: String(intent.price),
      roomTypeId: intent.roomTypeId ? String(intent.roomTypeId) : '',
      plan: intent.plan || '',
      planLabel: (intent.planLabel || '').slice(0, 480),
    },
    success_url: `${SITE}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/book?cancelled=1&checkIn=${intent.checkIn}&checkOut=${intent.checkOut}&guests=${intent.guests}` +
      (intent.roomTypeId ? `&roomTypeId=${intent.roomTypeId}` : '') +
      (intent.plan ? `&plan=${encodeURIComponent(intent.plan)}` : '') +
      `&price=${intent.price}`,
  });

  return NextResponse.redirect(session.url!, 303);
}
