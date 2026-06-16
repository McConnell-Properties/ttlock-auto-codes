// Creates a Stripe Checkout Session for the £80 security deposit on the shared
// deposits account. Card-type routing (hold vs charge vs block) is enforced in
// the deposits webhook after Stripe tells us card.funding.
import { NextRequest, NextResponse } from 'next/server';
import { findBookingByRef, verifyToken, PORTAL_COOKIE } from '@/lib/portal';
import { propertyForRequest } from '@/lib/properties';
import { depositsStripeKey } from '@/lib/stripe';
import { saveDepositRecord, getDepositRecord } from '@/lib/depositRecord';

export const dynamic = 'force-dynamic';

function siteUrl(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:4100';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const SITE = siteUrl(req);
  const prop = propertyForRequest(req);
  const ref = verifyToken(req.cookies.get(PORTAL_COOKIE)?.value);
  if (!ref) return NextResponse.redirect(`${SITE}/checkin?error=session`, 303);

  const booking = await findBookingByRef(ref);
  if (!booking) return NextResponse.redirect(`${SITE}/checkin?error=notfound`, 303);

  const stripeKey = depositsStripeKey();
  if (!stripeKey) {
    // Deposits Stripe account not yet configured.
    return NextResponse.redirect(`${SITE}/checkin?step=3&error=deposit_unavailable`, 303);
  }

  // Don't create a new session if one is already processing or secured.
  const existing = getDepositRecord(ref);
  const SECURED = new Set(['hold_active', 'captured', 'paid', 'succeeded']);
  if (existing && (SECURED.has(existing.status) || existing.status === 'pending')) {
    return NextResponse.redirect(`${SITE}/checkin?step=3`, 303);
  }

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(stripeKey);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: 8000,
        product_data: {
          name: `${prop.displayName} — Security deposit`,
          description: 'Refundable hold. Credit card: hold only. Debit card: refunded after checkout.',
        },
      },
    }],
    payment_intent_data: {
      capture_method: 'manual',
      metadata: {
        type: 'deposit',
        bookingRef: ref,
        property: prop.id,
        amount: '80',
      },
    },
    metadata: {
      type: 'deposit',
      bookingRef: ref,
      property: prop.id,
    },
    success_url: `${SITE}/checkin?step=3&depositPending=1`,
    cancel_url: `${SITE}/checkin?step=3`,
  });

  saveDepositRecord({
    ref,
    paymentIntent: null,
    checkoutSession: session.id,
    status: 'pending',
    amount: 80,
    mode: null,
    property: prop.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.redirect(session.url!, 303);
}
