import { NextRequest, NextResponse } from 'next/server';
import { findBookingByRef, verifyToken, addRequest, PORTAL_COOKIE } from '@/lib/portal';
import { propertyForRequest } from '@/lib/properties';
import { stripeKeyFor } from '@/lib/stripe';
import { calendarExtraTotal } from '@/lib/dynamicPricing';
import { rangeAvailable } from '@/lib/inventory';

export const dynamic = 'force-dynamic';

function siteUrl(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:4100';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

function londonNow(): { date: string; hour: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

export async function POST(req: NextRequest) {
  const SITE = siteUrl(req);
  const prop = propertyForRequest(req);
  const ref = verifyToken(req.cookies.get(PORTAL_COOKIE)?.value);
  if (!ref) return NextResponse.redirect(`${SITE}/checkin?error=session`, 303);

  const booking = await findBookingByRef(ref);
  if (!booking) return NextResponse.redirect(`${SITE}/checkin?error=notfound`, 303);

  const form = await req.formData();
  const earlyCheckin = String(form.get('earlyCheckin') ?? '').trim() || null;
  const parkingDate = String(form.get('parkingDate') ?? '').trim() || null;
  const parkingNights = parkingDate ? Math.min(30, Math.max(1, Number(form.get('parkingNights')) || 1)) : null;
  const luggageDate = String(form.get('luggageDate') ?? '').trim() || null;
  const luggageNights = luggageDate ? Math.min(5, Math.max(1, Number(form.get('luggageNights')) || 1)) : null;
  const luggageTime = luggageDate ? String(form.get('luggageTime') ?? '09:00').trim() : null;

  if (!earlyCheckin && !parkingDate && !luggageDate) {
    return NextResponse.redirect(`${SITE}/checkin?step=3`, 303);
  }

  const stripeKey = stripeKeyFor(prop.id);
  if (!stripeKey) {
    // No live Stripe key — auto-confirm and continue (test mode).
    if (earlyCheckin) {
      addRequest({
        ref, guestName: booking.guestName, extraId: 'early-checkin',
        extraName: `Early check-in at ${earlyCheckin}`,
        date: booking.checkIn, time: earlyCheckin === '1pm' ? '13:00' : '14:00',
        nights: null, price: 0, status: 'confirmed', stripeSession: null,
      });
    }
    if (luggageDate && luggageNights) {
      addRequest({
        ref, guestName: booking.guestName, extraId: 'luggage',
        extraName: 'Luggage drop-off',
        date: luggageDate, time: luggageTime, nights: luggageNights,
        price: 0, status: 'confirmed', stripeSession: null,
      });
    }
    return NextResponse.redirect(`${SITE}/checkin?step=3&paid=extras`, 303);
  }

  const { date: nowDate, hour: nowHour } = londonNow();
  const lineItems: import('stripe').Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  let earlyPrice = 0;
  let parkingTotal = 0;

  // Early check-in line item (deadline-aware price).
  if (earlyCheckin) {
    const deadlineDay = new Date(booking.checkIn + 'T00:00:00Z');
    deadlineDay.setUTCDate(deadlineDay.getUTCDate() - 1);
    const deadlineDayStr = deadlineDay.toISOString().slice(0, 10);
    const postDeadline = nowDate > deadlineDayStr || (nowDate === deadlineDayStr && nowHour >= 20);
    const is1pm = earlyCheckin === '1pm';
    earlyPrice = is1pm ? (postDeadline ? 15 : 10) : (postDeadline ? 10 : 5);
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: Math.round(earlyPrice * 100),
        product_data: {
          name: `${prop.displayName} — Early check-in at ${earlyCheckin}`,
          description: '100% refundable',
        },
      },
    });
  }

  // Parking line item.
  if (parkingDate && parkingNights) {
    if (!rangeAvailable('parking', parkingDate, parkingNights)) {
      return NextResponse.redirect(`${SITE}/checkin?step=3&error=soldout`, 303);
    }
    parkingTotal = await calendarExtraTotal('parking', parkingDate, parkingNights, prop.id);
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: Math.round(parkingTotal * 100),
        product_data: {
          name: `${prop.displayName} — Parking`,
          description: `${parkingNights} night${parkingNights > 1 ? 's' : ''} from ${parkingDate}`,
        },
      },
    });
  }

  // Luggage line item (flat £5/night).
  let luggageTotal = 0;
  if (luggageDate && luggageNights) {
    luggageTotal = 5 * luggageNights;
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: Math.round(luggageTotal * 100),
        product_data: {
          name: `${prop.displayName} — Luggage drop-off`,
          description: `${luggageNights} night${luggageNights > 1 ? 's' : ''}, drop-off ${luggageDate} at ${luggageTime}`,
        },
      },
    });
  }

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(stripeKey);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    payment_intent_data: {
      setup_future_usage: 'off_session',
    },
    metadata: {
      reservation_code: ref,
      type: 'checkin_extras',
      earlyCheckin: earlyCheckin || '',
      parkingDate: parkingDate || '',
      parkingNights: String(parkingNights || ''),
      luggageDate: luggageDate || '',
      luggageNights: String(luggageNights || ''),
      luggageTime: luggageTime || '',
    },
    success_url: `${SITE}/checkin/extras-paid?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/checkin?step=3`,
  });

  // Add pending-payment requests (both share the same session ID).
  if (earlyCheckin) {
    addRequest({
      ref, guestName: booking.guestName, extraId: 'early-checkin',
      extraName: `Early check-in at ${earlyCheckin}`,
      date: booking.checkIn, time: earlyCheckin === '1pm' ? '13:00' : '14:00',
      nights: null, price: earlyPrice, status: 'pending-payment', stripeSession: session.id,
    });
  }
  if (parkingDate && parkingNights) {
    addRequest({
      ref, guestName: booking.guestName, extraId: 'parking',
      extraName: 'Parking',
      date: parkingDate, time: null, nights: parkingNights,
      price: parkingTotal, status: 'pending-payment', stripeSession: session.id,
    });
  }
  if (luggageDate && luggageNights) {
    addRequest({
      ref, guestName: booking.guestName, extraId: 'luggage',
      extraName: 'Luggage drop-off',
      date: luggageDate, time: luggageTime, nights: luggageNights,
      price: luggageTotal, status: 'pending-payment', stripeSession: session.id,
    });
  }

  return NextResponse.redirect(session.url!, 303);
}
