// Channel-manager API client. The channel manager is the source of truth:
// availability is always fetched live, bookings are only created via its API.
//
// Port resilience: `next dev` auto-increments ports, so the channel manager
// can move between restarts (3000 → 3001 → 3002…). We try the configured URL
// first, then probe the usual suspects, and remember what worked.
const CANDIDATES = Array.from(
  new Set([
    process.env.CHANNEL_MANAGER_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
  ])
);
let cmBase: string | null = null;

// When the channel manager is deployed with auth, set CM_API_KEY in .env here
// to match — sent as a Bearer token on every API call. Harmless locally.
export function cmHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = process.env.CM_API_KEY;
  return key ? { ...extra, Authorization: `Bearer ${key}` } : extra;
}

async function isChannelManager(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/properties`, { cache: 'no-store', headers: cmHeaders(), signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data?.properties); // distinguishes the CM from other local apps
  } catch {
    return false;
  }
}

export async function cm(): Promise<string> {
  if (cmBase && (await isChannelManager(cmBase))) return cmBase;
  for (const base of CANDIDATES) {
    if (await isChannelManager(base)) {
      cmBase = base;
      return base;
    }
  }
  throw new Error(
    `channel manager not found on ${CANDIDATES.join(', ')} — is it running? (check its terminal for the port)`
  );
}

export type AvailabilityRow = {
  propertyId: string;
  propertyName: string;
  roomTypeId: number;
  roomTypeName: string;
  available: number;
  nights: number;
  totalPrice: number;
};

export async function getAvailability(checkIn: string, checkOut: string, property = 'streatham') {
  const res = await fetch(
    `${await cm()}/api/availability?checkIn=${checkIn}&checkOut=${checkOut}&property=${property}`,
    { cache: 'no-store', headers: cmHeaders() }
  );
  if (!res.ok) throw new Error(`channel manager availability failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.results as AvailabilityRow[];
}

// ---------- check-in ingest push ----------

export type CheckinUpsertPayload = {
  ref: string;
  property?: string;
  confirmedAt?: string | null;
  contact?: {
    contactMethods?: { method: string; value: string }[];
    earlyCheckin?: string | null;
    parking?: boolean;
    luggage?: { date: string; nights: number; time: string } | null;
    cardSaved?: boolean;
    savedAt?: string | null;
  } | null;
  extras?: {
    extraId: string;
    extraName: string;
    date?: string | null;
    time?: string | null;
    nights?: number | null;
    price?: number;
    status: string;
    stripeSession?: string | null;
  }[];
  updatedAt?: string;
};

// Best-effort push to the CMS check-in ingest endpoint. Never throws — if the
// CMS is unreachable the guest flow continues and the .data files are unchanged.
// No-ops silently if CHANNEL_MANAGER_URL or CM_API_KEY are not set.
export async function postCheckinUpsert(payload: CheckinUpsertPayload): Promise<void> {
  const url = process.env.CHANNEL_MANAGER_URL;
  const key = process.env.CM_API_KEY;
  if (!url || !key) return; // local dev without CMS env — silent no-op
  try {
    const res = await fetch(`${url}/api/checkin/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) console.warn(`postCheckinUpsert: CMS returned ${res.status}`, data);
    else if (data.matched === false) console.log(`postCheckinUpsert: ref ${payload.ref} not yet in CMS`);
  } catch (e) {
    console.warn('postCheckinUpsert: push failed (best-effort):', e);
  }
}

// ---------- bookings ----------

export type CreateBookingInput = {
  roomTypeId: number;
  guestName: string;
  checkIn: string;
  checkOut: string;
  email?: string;
  phone?: string;
  units?: number;
  totalPrice?: number;
  channelRef?: string;
  notes?: string;
};

export async function createBooking(input: CreateBookingInput) {
  const res = await fetch(`${await cm()}/api/bookings`, {
    method: 'POST',
    headers: cmHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 201) return { ok: true as const, bookingId: data.bookingId as number };
  if (res.status === 409) return { ok: false as const, soldOut: true, error: 'Room no longer available' };
  return { ok: false as const, soldOut: false, error: data.error || `booking failed (${res.status})` };
}
