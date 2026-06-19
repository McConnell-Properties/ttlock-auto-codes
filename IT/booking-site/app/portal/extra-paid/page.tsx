import { redirect } from 'next/navigation';
import { markRequestPaid } from '@/lib/portal';
import { currentProperty } from '@/lib/properties';
import { stripeKeyFor } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export default async function ExtraPaidPage({
  searchParams,
}: {
  searchParams: { session_id?: string; returnTo?: string };
}) {
  const sessionId = searchParams.session_id;
  const prop = currentProperty();
  const stripeKey = stripeKeyFor(prop.id);
  if (sessionId && stripeKey) {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(stripeKey);
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') await markRequestPaid(sessionId);
    } catch { /* fall through */ }
  }

  // returnTo must be a relative path (validated to start with /) to prevent open redirect.
  const returnTo = searchParams.returnTo ?? '';
  redirect(returnTo.startsWith('/') ? returnTo : '/portal?paid=1');
}
