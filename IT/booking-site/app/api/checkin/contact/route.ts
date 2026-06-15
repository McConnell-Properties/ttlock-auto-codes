import { NextRequest, NextResponse } from 'next/server';
import { findBookingByRef, verifyToken, PORTAL_COOKIE } from '@/lib/portal';
import { saveCheckinContact, type ContactMethod } from '@/lib/checkinContacts';
import { postCheckinUpsert } from '@/lib/cm';

export const dynamic = 'force-dynamic';

const VALID_METHODS = new Set<string>(['phone', 'whatsapp', 'email']);

// Returns whether the 20:00 UK early check-in deadline (day before checkIn) has passed.
function isPostEarlyDeadline(checkInDate: string): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const londonDate = `${get('year')}-${get('month')}-${get('day')}`;
  const londonHour = Number(get('hour'));

  // Deadline day = checkIn - 1 day
  const ci = new Date(checkInDate + 'T00:00:00Z');
  ci.setUTCDate(ci.getUTCDate() - 1);
  const deadlineDay = ci.toISOString().slice(0, 10);

  if (londonDate > deadlineDay) return true;
  if (londonDate === deadlineDay && londonHour >= 20) return true;
  return false;
}

function siteUrl(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:4100';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const SITE = siteUrl(req);
  const ref = verifyToken(req.cookies.get(PORTAL_COOKIE)?.value);
  if (!ref) return NextResponse.redirect(`${SITE}/checkin?error=session`, 303);

  const form = await req.formData();

  // Contact methods — multi-select; at least one required.
  const contactMethods: ContactMethod[] = [];
  for (const method of ['phone', 'whatsapp', 'email'] as const) {
    if (form.get(`contact_${method}`) === '1') {
      const value = String(form.get(`contact_${method}_value`) ?? '').trim();
      if (value && VALID_METHODS.has(method)) {
        contactMethods.push({ method, value });
      }
    }
  }
  if (contactMethods.length === 0) {
    return NextResponse.redirect(`${SITE}/checkin?step=2&error=missing`, 303);
  }

  // Early check-in choice.
  const earlyRaw = String(form.get('earlyCheckin') ?? '').trim();
  const earlyCheckin: '1pm' | '2pm' | null =
    earlyRaw === '1pm' ? '1pm' : earlyRaw === '2pm' ? '2pm' : null;

  // Early check-in display price (recomputed at charge time in /api/extras).
  let earlyCheckinPrice: number | null = null;
  if (earlyCheckin) {
    const booking = await findBookingByRef(ref);
    if (booking?.checkIn) {
      const post = isPostEarlyDeadline(booking.checkIn);
      earlyCheckinPrice = earlyCheckin === '1pm' ? (post ? 15 : 10) : (post ? 10 : 5);
    }
  }

  const parking = form.get('parking') === '1';

  const luggageOn = form.get('luggage') === '1';
  const luggage = luggageOn ? {
    date: String(form.get('luggageDate') ?? '').trim(),
    nights: Math.min(5, Math.max(1, Number(form.get('luggageNights')) || 1)),
    time: String(form.get('luggageTime') ?? '09:00').trim(),
  } : null;

  const savedAt = new Date().toISOString();
  saveCheckinContact({ ref, contactMethods, earlyCheckin, earlyCheckinPrice, parking, luggage });

  // Best-effort CMS push — fire-and-forget; never blocks the redirect.
  void postCheckinUpsert({
    ref,
    contact: { contactMethods, earlyCheckin, parking, luggage, cardSaved: false, savedAt },
    updatedAt: savedAt,
  });

  return NextResponse.redirect(`${SITE}/checkin?step=3`, 303);
}
