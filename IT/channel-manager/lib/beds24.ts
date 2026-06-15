import { db } from './db';

const BASE_URL = 'https://api.beds24.com/v2';
const REFRESH_GRACE_MS = 5 * 60 * 1000; // refresh when < 5 min left

// ── Token management ─────────────────────────────────────────────────────────

let memToken: string | null = null;
let memExpiresAt = 0;

async function loadCachedToken(): Promise<{ token: string; expiresAt: number } | null> {
  const row = await db.execute({ sql: 'SELECT value FROM Setting WHERE key = ?', args: ['beds24_token'] });
  if (!row.rows[0]) return null;
  try {
    return JSON.parse(row.rows[0].value as string) as { token: string; expiresAt: number };
  } catch {
    return null;
  }
}

async function persistToken(token: string, expiresAt: number) {
  const value = JSON.stringify({ token, expiresAt });
  await db.execute({
    sql: `INSERT INTO Setting (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: ['beds24_token', value],
  });
}

async function refreshToken(): Promise<string> {
  const refreshTok = process.env.BEDS24_REFRESH_TOKEN;
  if (!refreshTok) throw new Error('BEDS24_REFRESH_TOKEN not set');

  const res = await fetch(`${BASE_URL}/authentication/token`, {
    headers: { refreshToken: refreshTok },
  });
  if (!res.ok) throw new Error(`Beds24 token refresh failed: HTTP ${res.status}`);

  const data = (await res.json()) as { token: string; expiresIn: number };
  const expiresAt = Date.now() + data.expiresIn * 1000;

  memToken = data.token;
  memExpiresAt = expiresAt;
  await persistToken(data.token, expiresAt);
  return data.token;
}

export async function getToken(): Promise<string> {
  const now = Date.now();

  // 1. In-process cache (fastest path)
  if (memToken && memExpiresAt - now > REFRESH_GRACE_MS) return memToken;

  // 2. Turso cache (shared across instances/restarts)
  const cached = await loadCachedToken();
  if (cached && cached.expiresAt - now > REFRESH_GRACE_MS) {
    memToken = cached.token;
    memExpiresAt = cached.expiresAt;
    return cached.token;
  }

  // 3. Refresh via refreshToken
  return refreshToken();
}

// ── Generic API helper ────────────────────────────────────────────────────────

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Beds24Options {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

export async function beds24<T = unknown>(
  method: Method,
  path: string,
  opts: Beds24Options = {},
): Promise<T> {
  return beds24WithRetry(method, path, opts, false);
}

async function beds24WithRetry<T>(
  method: Method,
  path: string,
  opts: Beds24Options,
  isRetry: boolean,
): Promise<T> {
  const token = await getToken();
  const qs = opts.query ? buildQuery(opts.query) : '';
  const url = `${BASE_URL}${path}${qs}`;

  const res = await fetch(url, {
    method,
    headers: {
      token,
      'Content-Type': 'application/json',
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // Log rate-limit telemetry on every response
  const remaining = res.headers.get('x-five-min-limit-remaining');
  const cost = res.headers.get('x-request-cost');
  if (remaining !== null || cost !== null) {
    const tag = remaining !== null && Number(remaining) < 20 ? '[BEDS24 RATE LOW]' : '[beds24]';
    console.log(`${tag} ${method} ${path} cost=${cost ?? '?'} remaining=${remaining ?? '?'}`);
  }

  // 401 → refresh token once and retry
  if (res.status === 401 && !isRetry) {
    memToken = null;
    memExpiresAt = 0;
    await refreshToken();
    return beds24WithRetry(method, path, opts, true);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Beds24 ${method} ${path} → HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Calendar payload builder (shared by CC-B and CC-D) ───────────────────────

export interface CalendarEntry {
  roomId: number;
  from: string;   // YYYY-MM-DD
  to: string;     // YYYY-MM-DD (inclusive end)
  price?: number | null;
  numAvail?: number | null;
  minStay?: number | null;
}

export interface Beds24CalendarItem {
  roomId: number;
  calendar: Array<{
    from: string;
    to: string;
    price1?: number | null;
    numAvail?: number | null;
    minStay?: number | null;
  }>;
}

/**
 * Builds the POST /inventory/rooms/calendar body from a flat list of entries.
 * Groups entries by roomId and maps field names to Beds24 conventions.
 * Pass price: null / numAvail: null to clear an existing override.
 */
export function buildCalendarPayload(entries: CalendarEntry[]): Beds24CalendarItem[] {
  const byRoom = new Map<number, Beds24CalendarItem>();

  for (const e of entries) {
    let item = byRoom.get(e.roomId);
    if (!item) {
      item = { roomId: e.roomId, calendar: [] };
      byRoom.set(e.roomId, item);
    }
    const cal: Beds24CalendarItem['calendar'][number] = { from: e.from, to: e.to };
    if (e.price !== undefined) cal.price1 = e.price;
    if (e.numAvail !== undefined) cal.numAvail = e.numAvail;
    if (e.minStay !== undefined) cal.minStay = e.minStay;
    item.calendar.push(cal);
  }

  return Array.from(byRoom.values());
}
