import { NextRequest, NextResponse } from 'next/server';
import { markBookingBySession } from '@/lib/data';

export const dynamic = 'force-dynamic';

// POST /api/stripe/session-status
// Updates Booking.stripeStatus from the booking-site stripe-webhook.
// Body: { sessionId: string, status: 'paid' | 'expired' }
// Requires Bearer CM_API_KEY (enforced by middleware).
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const { sessionId, status } = body || {};
  if (!sessionId || !['paid', 'expired'].includes(status)) {
    return NextResponse.json({ error: 'sessionId and status (paid|expired) are required' }, { status: 400 });
  }

  const updated = await markBookingBySession(sessionId, status);
  return NextResponse.json({ ok: true, updated });
}
