// Stripe webhook — the INSTANT confirmation path for every payment type.
// The redirect/success pages still confirm too (and every poll job remains as
// a safety net), but this fires the second Stripe records the payment, even
// if the guest closes the tab:
//
//   1. extras            (metadata.extra)            → request marked paid
//   2. direct bookings   (metadata.checkIn + kind)   → booking created (idempotent)
//   3. phone-booking links (no site metadata)        → channel-manager Booking
//                                                      marked paid by session id
//
// Setup (one-time, Stripe Dashboard → Developers → Webhooks):
//   endpoint  https://www.streathamrooms.co.uk/api/stripe-webhook
//   event     checkout.session.completed
//   then put the signing secret in .env as STRIPE_WEBHOOK_SECRET=whsec_...
//
// Note: the existing Apps Script webhook (deposit links → Reservation Data
// sheet) stays as its own Stripe endpoint — Stripe delivers to both.
import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { markRequestPaid, markAllRequestsPaid } from '@/lib/portal';
import { markCardSaved } from '@/lib/checkinContacts';
import { postCheckinUpsert } from '@/lib/cm';
import { createBookingsFromIntent, Intent } from '@/lib/bookings';
import { allWebhookSecrets, anyStripeKey } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

const CM_DB = path.resolve(process.cwd(), process.env.CM_DB_PATH || '../channel-manager/db/dev.db');

async function markChannelManagerPaid(sessionId: string): Promise<boolean> {
  try {
    const db = createClient({ url: `file:${CM_DB}` });
    const r = await db.execute({
      sql: `UPDATE Booking SET stripeStatus = 'paid', paidAt = ?
            WHERE stripeSessionId = ? AND stripeStatus = 'link_sent'`,
      args: [new Date().toISOString(), sessionId],
    });
    db.close();
    return r.rowsAffected > 0;
  } catch (e) {
    console.error('stripe-webhook: channel-manager update failed:', e);
    return false;
  }
}

export async function POST(req: NextRequest) {
  // Stripe delivers to one URL; multiple properties may have their own accounts
  // with separate signing secrets. Try each configured secret until one verifies.
  const secrets = allWebhookSecrets();
  const stripeKey = anyStripeKey();
  if (!stripeKey || secrets.length === 0) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 500 });
  }

  // raw body is required for signature verification
  const payload = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(stripeKey);
  let event: import('stripe').Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(payload, sig, secret);
      break;
    } catch { /* wrong secret — try next */ }
  }
  if (!event) {
    return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  }

  // expired phone-booking links → release immediately (poll used to do this hourly)
  if (event.type === 'checkout.session.expired') {
    const s = event.data.object as import('stripe').Stripe.Checkout.Session;
    try {
      const db = createClient({ url: `file:${CM_DB}` });
      await db.execute({
        sql: `UPDATE Booking SET stripeStatus = 'expired' WHERE stripeSessionId = ? AND stripeStatus = 'link_sent'`,
        args: [s.id],
      });
      db.close();
    } catch (e) { console.error('stripe-webhook: expire update failed:', e); }
    return NextResponse.json({ received: true, handled: 'expired' });
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as import('stripe').Stripe.Checkout.Session;
  if (session.payment_status !== 'paid') return NextResponse.json({ received: true, unpaid: true });
  const m = session.metadata || {};

  // 1. portal extras payment
  if (m.extra) {
    const req2 = markRequestPaid(session.id);
    console.log(`stripe-webhook: extra ${m.extra} for ${m.reservation_code} → ${req2 ? 'paid' : 'request not found'}`);
    return NextResponse.json({ received: true, handled: 'extra' });
  }

  // 1b. check-in extras (combined session — one Stripe session may cover multiple
  // extras + card save). Mark all matching requests paid, save the card flag, push
  // to CMS so staff see the paid line items immediately.
  if (m.type === 'checkin_extras') {
    const paid = markAllRequestsPaid(session.id);
    markCardSaved(m.reservation_code);
    console.log(`stripe-webhook: checkin extras for ${m.reservation_code} → ${paid.length} paid`);
    void postCheckinUpsert({
      ref: m.reservation_code,
      contact: { cardSaved: true, savedAt: new Date().toISOString() },
      extras: paid.map((r) => ({
        extraId: r.extraId,
        extraName: r.extraName,
        date: r.date ?? null,
        time: r.time ?? null,
        nights: r.nights ?? null,
        price: r.price,
        status: r.status,
        stripeSession: r.stripeSession ?? null,
      })),
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ received: true, handled: 'checkin-extras', count: paid.length });
  }

  // 2. direct site booking (idempotent — no-op if the success page already ran)
  if (m.checkIn && m.checkOut && m.kind) {
    const intent: Intent = {
      kind: (m.kind as 'single' | 'plan') || 'single',
      checkIn: m.checkIn, checkOut: m.checkOut,
      guests: Number(m.guests) || 1,
      guestName: m.guestName || 'Guest',
      email: m.email || session.customer_email || '',
      phone: m.phone || '', notes: m.notes || '',
      price: parseFloat(m.price || '0'),
      roomTypeId: m.roomTypeId ? Number(m.roomTypeId) : undefined,
      plan: m.plan || undefined, planLabel: m.planLabel || undefined,
    };
    const result = await createBookingsFromIntent(intent, m.reservation_code || session.id);
    console.log(`stripe-webhook: direct booking ${m.reservation_code || session.id} → ${result.ok ? `ids ${result.bookingIds}` : result.error}`);
    return NextResponse.json({ received: true, handled: 'booking', ok: result.ok });
  }

  // 3. phone-booking payment link (channel-manager created the session)
  const updated = await markChannelManagerPaid(session.id);
  console.log(`stripe-webhook: session ${session.id} → ${updated ? 'phone booking marked paid' : 'no matching booking (likely GAS deposit link — its own webhook handles it)'}`);
  return NextResponse.json({ received: true, handled: updated ? 'phone-booking' : 'none' });
}
