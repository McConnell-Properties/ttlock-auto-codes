import { NextRequest, NextResponse } from 'next/server';
import { extraById, priceForExtra } from '@/lib/extras';
import { calendarExtraTotal } from '@/lib/dynamicPricing';
import { rangeAvailable } from '@/lib/inventory';
import { addRequest, findBookingByRef, verifyToken, PORTAL_COOKIE } from '@/lib/portal';
import { propertyForRequest } from '@/lib/properties';
import { stripeKeyFor } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Same-day services must be booked & paid before 11am (Europe/London).
const SAME_DAY_CUTOFF_IDS = new Set(['towel-exchange', 'laundry', 'room-clean', 'luggage', 'early-checkin', 'late-checkout']);

function londonNow(): { date: string; hour: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function siteUrl(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:4100';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const SITE = siteUrl(req);
  const prop = propertyForRequest(req);
  const ref = verifyToken(req.cookies.get(PORTAL_COOKIE)?.value);
  if (!ref) return NextResponse.redirect(`${SITE}/portal?error=2`, 303);

  const form = await req.formData();
  const extra = extraById(String(form.get('extraId') ?? ''));
  if (!extra) return NextResponse.redirect(`${SITE}/portal?error=3`, 303);

  const booking = await findBookingByRef(ref);
  const guestName = booking?.guestName || 'Guest';

  const date = String(form.get('date') ?? '').trim() || null;
  const time =
    String(form.get('time') ?? form.get('earlyTime') ?? form.get('lateTime') ?? '').trim() || null;
  const nights = form.get('nights') ? Math.min(30, Math.max(1, Number(form.get('nights')) || 1)) : null;
  const guestType = String(form.get('guestType') ?? '').trim() || undefined;

  // 11am same-day cutoff for service extras
  if (SAME_DAY_CUTOFF_IDS.has(extra.id) && date) {
    const now = londonNow();
    if (date < now.date || (date === now.date && now.hour >= 11)) {
      return NextResponse.redirect(`${SITE}/portal?error=cutoff&extra=${extra.id}`, 303);
    }
  }

  // Optional return path for non-portal callers (e.g. /checkin).
  const returnPath = String(form.get('returnPath') ?? '').trim();
  const safeReturn = returnPath.startsWith('/') ? returnPath : '';

  // ---- price ----
  let price: number;
  if (extra.calendar) {
    if (!date || !nights) return NextResponse.redirect(`${SITE}/portal?error=3`, 303);
    if (!await rangeAvailable(extra.id, date, nights)) {
      return NextResponse.redirect(`${SITE}/portal?error=soldout&extra=${extra.id}`, 303);
    }
    if (extra.id === 'aircon' || extra.id === 'parking') {
      price = await calendarExtraTotal(extra.id, date, nights, prop.id);
    } else if (extra.id === 'cooking-pack') {
      price = 15; // flat pack hire fee, no per-night cost
    } else {
      // extra-guest-double / extra-guest-single
      const rate = guestType === 'child' ? 2.5 : 5;
      price = Math.round((rate * nights + 10) * 100) / 100;
    }
  } else if (extra.id === 'early-checkin') {
    // Deadline-aware pricing: £10→£15 for 1pm, £5→£10 for 2pm after 20:00 UK the day before check-in.
    const bk = await findBookingByRef(ref);
    if (!bk?.checkIn) return NextResponse.redirect(`${SITE}/portal?error=3`, 303);
    const { date: nowDate, hour: nowHour } = londonNow();
    const deadlineDay = new Date(bk.checkIn + 'T00:00:00Z');
    deadlineDay.setUTCDate(deadlineDay.getUTCDate() - 1);
    const deadlineDayStr = deadlineDay.toISOString().slice(0, 10);
    const postDeadline = nowDate > deadlineDayStr || (nowDate === deadlineDayStr && nowHour >= 20);
    const is1pm = time === '13:00';
    price = is1pm ? (postDeadline ? 15 : 10) : (postDeadline ? 10 : 5);
  } else {
    price = priceForExtra(extra.id, { nights: nights ?? undefined, lateTime: time ?? undefined, guestType });
    if (price < 0) return NextResponse.redirect(`${SITE}/portal?error=3`, 303);
  }

  const stripeKey = stripeKeyFor(prop.id);

  // Free extras, or no Stripe configured → auto-confirmed immediately.
  const extraLabel = guestType ? `${extra.name} (${guestType})` : extra.name;

  if (price === 0 || !stripeKey) {
    await addRequest({
      ref, guestName, extraId: extra.id, extraName: extraLabel,
      date, time, nights, price,
      status: 'confirmed', stripeSession: null,
    });
    return NextResponse.redirect(`${SITE}/portal?requested=${extra.id}`, 303);
  }

  // Paid extra → Stripe Checkout; confirmed automatically once paid.
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(stripeKey);
  const bits = [date, time, nights ? `${nights} night${nights > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ');
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: Math.round(price * 100),
        product_data: {
          name: `${prop.displayName} — ${extra.name}`,
          description: `${bits || extra.blurb.slice(0, 100)}${extra.refundable ? ' · 100% refundable' : ''}`,
        },
      },
    }],
    metadata: { reservation_code: ref, extra: extra.id, date: date || '', time: time || '', nights: String(nights || ''), guestType: guestType || '' },
    success_url: `${SITE}/portal/extra-paid?session_id={CHECKOUT_SESSION_ID}${safeReturn ? `&returnTo=${encodeURIComponent(safeReturn)}` : ''}`,
    cancel_url: safeReturn ? `${SITE}${safeReturn}` : `${SITE}/portal`,
  });
  await addRequest({
    ref, guestName, extraId: extra.id, extraName: extraLabel,
    date, time, nights, price,
    status: 'pending-payment', stripeSession: session.id,
  });
  return NextResponse.redirect(session.url!, 303);
}
