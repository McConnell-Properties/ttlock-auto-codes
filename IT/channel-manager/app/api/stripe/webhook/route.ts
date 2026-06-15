// Stripe webhook — real-time payment updates once deployed (replaces polling).
// Configure in Stripe Dashboard → Developers → Webhooks:
//   endpoint: https://<your-domain>/api/stripe/webhook
//   events:   checkout.session.completed, checkout.session.expired
// Put the endpoint's signing secret in .env as STRIPE_WEBHOOK_SECRET.
//
// Verifies the Stripe-Signature header itself, so it's exempt from the auth
// middleware. Until STRIPE_WEBHOOK_SECRET is set it answers 503 (keep using
// stripe:sync polling locally).
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { setBookingStripe } from '@/lib/data';

export const dynamic = 'force-dynamic';

function verify(body: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts.t;
  const v1 = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || v1.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5 min tolerance
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return v1.some((sig) => {
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
    catch { return false; }
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhook not configured' }, { status: 503 });

  const body = await req.text();
  if (!verify(body, req.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  }

  const event = JSON.parse(body);
  const session = event?.data?.object;
  const bookingId = Number(session?.metadata?.booking_id);

  if (bookingId) {
    if (event.type === 'checkout.session.completed' && session.payment_status === 'paid') {
      await setBookingStripe(bookingId, { stripeStatus: 'paid', paidAt: new Date().toISOString() });
    } else if (event.type === 'checkout.session.expired') {
      await setBookingStripe(bookingId, { stripeStatus: 'expired' });
    }
  }

  return NextResponse.json({ received: true });
}
