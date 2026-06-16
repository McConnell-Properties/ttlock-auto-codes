// Stripe webhook for the shared deposits account.
// Handles checkout.session.completed → reads card.funding → routes to hold (credit),
// immediate capture (debit), or cancel (prepaid). Reports every status change to CMS.
//
// Setup (one-time, in the DEPOSITS Stripe account dashboard):
//   Developers → Webhooks → Add endpoint
//   URL: https://www.streathamrooms.co.uk/api/webhooks/deposits
//   Event: checkout.session.completed
//   Copy signing secret → STRIPE_WEBHOOK_SECRET_DEPOSITS in .env
import { NextRequest, NextResponse } from 'next/server';
import { depositsStripeKey, depositsWebhookSecret } from '@/lib/stripe';
import { getDepositRecord, updateDepositStatus, saveDepositRecord } from '@/lib/depositRecord';
import { postCheckinUpsert } from '@/lib/cm';

export const dynamic = 'force-dynamic';

async function reportToCms(
  ref: string,
  property: string,
  paymentIntent: string | null,
  status: string,
  amount: number,
  mode: string | null
) {
  void postCheckinUpsert({
    ref,
    property,
    deposit: { paymentIntent, status, amount, mode },
    updatedAt: new Date().toISOString(),
  });
}

export async function POST(req: NextRequest) {
  const stripeKey = depositsStripeKey();
  const secret = depositsWebhookSecret();
  if (!stripeKey || !secret) {
    return NextResponse.json({ error: 'deposits webhook not configured' }, { status: 500 });
  }

  const payload = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(stripeKey);

  let event: import('stripe').Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, sig, secret);
  } catch {
    return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as import('stripe').Stripe.Checkout.Session;
  const m = session.metadata || {};
  if (m.type !== 'deposit') {
    return NextResponse.json({ received: true, ignored: 'not a deposit session' });
  }

  const { bookingRef, property } = m;
  if (!bookingRef) {
    return NextResponse.json({ error: 'missing bookingRef in session metadata' }, { status: 400 });
  }

  const piId = session.payment_intent as string;

  // Retrieve PI with payment method expanded to read card.funding.
  const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['payment_method'] });
  const pm = pi.payment_method as import('stripe').Stripe.PaymentMethod | null;
  const funding = pm?.card?.funding;

  let status: string;
  let mode: 'hold' | 'charge' | 'prepaid';

  if (funding === 'prepaid') {
    await stripe.paymentIntents.cancel(piId);
    status = 'cancelled';
    mode = 'prepaid';
    console.log(`deposits-webhook: ${bookingRef} prepaid card blocked — PI ${piId} cancelled`);
  } else if (funding === 'debit') {
    await stripe.paymentIntents.capture(piId);
    status = 'captured';
    mode = 'charge';
    console.log(`deposits-webhook: ${bookingRef} debit card — PI ${piId} captured (charge)`);
  } else {
    // credit or unknown — leave in requires_capture (the hold)
    status = 'hold_active';
    mode = 'hold';
    console.log(`deposits-webhook: ${bookingRef} credit card — PI ${piId} hold_active`);
  }

  const now = new Date().toISOString();
  const existing = getDepositRecord(bookingRef);
  if (existing) {
    updateDepositStatus(bookingRef, { paymentIntent: piId, status, mode, updatedAt: now });
  } else {
    saveDepositRecord({
      ref: bookingRef,
      paymentIntent: piId,
      checkoutSession: session.id,
      status,
      amount: 80,
      mode,
      property: property ?? '',
      createdAt: now,
      updatedAt: now,
    });
  }

  void reportToCms(bookingRef, property ?? '', piId, status, 80, mode);

  return NextResponse.json({ received: true, handled: 'deposit', status, mode });
}
