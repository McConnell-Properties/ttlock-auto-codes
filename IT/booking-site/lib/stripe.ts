// Per-property Stripe key resolution.
// Each property may have its own Stripe account; keys are stored as
// STRIPE_SECRET_KEY_<PROPERTY> (e.g. STRIPE_SECRET_KEY_GASSIOT).
// Falls back to the generic STRIPE_SECRET_KEY for any property not yet configured.

const PROPERTY_IDS = ['streatham', 'gassiot', 'tooting', 'valnay', 'seamless'];

export function stripeKeyFor(propertyId: string): string | undefined {
  const upper = propertyId.toUpperCase();
  return process.env[`STRIPE_SECRET_KEY_${upper}`] ?? process.env.STRIPE_SECRET_KEY;
}

export function webhookSecretFor(propertyId: string): string | undefined {
  const upper = propertyId.toUpperCase();
  return process.env[`STRIPE_WEBHOOK_SECRET_${upper}`] ?? process.env.STRIPE_WEBHOOK_SECRET;
}

// Returns all configured webhook signing secrets (per-property first, then generic).
// Used in the webhook route to try each secret until one verifies — because Stripe
// delivers to a single URL from multiple accounts, so we cannot know in advance
// which account signed a given webhook event.
export function allWebhookSecrets(): string[] {
  const result: string[] = [];
  for (const id of PROPERTY_IDS) {
    const v = process.env[`STRIPE_WEBHOOK_SECRET_${id.toUpperCase()}`];
    if (v) result.push(v);
  }
  const generic = process.env.STRIPE_WEBHOOK_SECRET;
  if (generic && !result.includes(generic)) result.push(generic);
  return result;
}

// Returns the first available Stripe API key for SDK initialisation in contexts where
// the specific property is unknown (e.g. webhook signature verification loop).
export function anyStripeKey(): string | undefined {
  for (const id of PROPERTY_IDS) {
    const v = process.env[`STRIPE_SECRET_KEY_${id.toUpperCase()}`];
    if (v) return v;
  }
  return process.env.STRIPE_SECRET_KEY;
}

// Shared deposits account — all properties' £80 security deposits live here.
export function depositsStripeKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY_DEPOSITS;
}

export function depositsWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET_DEPOSITS;
}
