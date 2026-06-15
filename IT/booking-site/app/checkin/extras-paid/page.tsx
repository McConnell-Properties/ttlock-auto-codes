import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifyToken, markAllRequestsPaid, PORTAL_COOKIE } from '@/lib/portal';
import { markCardSaved } from '@/lib/checkinContacts';
import { currentProperty } from '@/lib/properties';
import { stripeKeyFor } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export default async function CheckinExtrasPaidPage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  const ref = verifyToken(cookies().get(PORTAL_COOKIE)?.value);
  const sessionId = searchParams.session_id;
  const prop = currentProperty();
  const stripeKey = stripeKeyFor(prop.id);

  if (ref && sessionId && stripeKey) {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(stripeKey);
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        markAllRequestsPaid(sessionId);
        markCardSaved(ref); // card saved via setup_future_usage: off_session
      }
    } catch { /* fall through */ }
  }

  redirect('/checkin?step=3&paid=extras');
}
