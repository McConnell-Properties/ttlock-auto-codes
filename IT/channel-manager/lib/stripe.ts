// Minimal Stripe API client (form-encoded fetch — no SDK dependency).
// Requires STRIPE_SECRET_KEY in .env.

const API = 'https://api.stripe.com/v1';

function key(propertyId?: string): string {
  if (propertyId) {
    const perProp = process.env[`STRIPE_SECRET_KEY_${propertyId.toUpperCase()}`];
    if (perProp) return perProp;
  }
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error('STRIPE_SECRET_KEY is not set in .env');
  return k;
}

async function stripePost(path: string, params: Record<string, string>, propertyId?: string) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key(propertyId)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const j = await res.json();
  if (j.error) throw new Error(`Stripe: ${j.error.message}`);
  return j;
}

async function stripeGet(path: string, propertyId?: string) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${key(propertyId)}` },
  });
  const j = await res.json();
  if (j.error) throw new Error(`Stripe: ${j.error.message}`);
  return j;
}

export async function createCheckoutSession(opts: {
  bookingId: number;
  amountGbp: number;
  description: string;
  customerEmail?: string | null;
  successUrl: string;
  expiresHours?: number;
  reservationCode?: string | null;
  propertyId?: string; // selects STRIPE_SECRET_KEY_<PROPERTY> if set
}) {
  const params: Record<string, string> = {
    mode: 'payment',
    'line_items[0][price_data][currency]': 'gbp',
    'line_items[0][price_data][unit_amount]': String(Math.round(opts.amountGbp * 100)),
    'line_items[0][price_data][product_data][name]': opts.description,
    'line_items[0][quantity]': '1',
    success_url: opts.successUrl,
    'metadata[booking_id]': String(opts.bookingId),
    'payment_intent_data[metadata][booking_id]': String(opts.bookingId),
    expires_at: String(Math.floor(Date.now() / 1000) + (opts.expiresHours ?? 24) * 3600),
  };
  if (opts.reservationCode) {
    params['metadata[reservation_code]'] = opts.reservationCode;
  }
  if (opts.customerEmail) params.customer_email = opts.customerEmail;
  const s = await stripePost('/checkout/sessions', params, opts.propertyId);
  return { sessionId: s.id as string, url: s.url as string };
}

// Returns 'paid' | 'open' | 'expired'
export async function getSessionStatus(sessionId: string, propertyId?: string): Promise<string> {
  const s = await stripeGet(`/checkout/sessions/${sessionId}`, propertyId);
  if (s.payment_status === 'paid') return 'paid';
  if (s.status === 'expired') return 'expired';
  return 'open';
}
