// Guest portal: booking lookup (ref + surname), signed session cookie,
// and the extras-requests ledger.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@libsql/client';

const CHECKIN_DATA =
  process.env.CHECKIN_DATA_PATH ||
  '/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/automation-data/checkin_data.json';
const RES_STATUS =
  process.env.RESERVATION_STATUS_PATH ||
  '/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/automation-data/reservation_status.csv';
const CM_DB = path.resolve(process.cwd(), process.env.CM_DB_PATH || '../channel-manager/db/dev.db');
const SECRET = process.env.PORTAL_SECRET || 'change-me-portal-secret';
const REQUESTS = path.join(process.cwd(), '.data', 'extras-requests.json');

export type GuestBooking = {
  ref: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  room: string | null; // e.g. "Room 4"
  arrivalTime: string | null;
  lockCode: string | null;
  stripeLink: string | null;   // deposit checkout URL from the existing pipeline
  stripeStatus: string | null; // e.g. 'hold_active', 'captured', 'link_generated'
};

// ---------- lookup ----------

function surnameMatches(guestName: string, surname: string): boolean {
  const s = surname.trim().toLowerCase();
  if (s.length < 2) return false;
  const name = (guestName || '').toLowerCase();
  const last = name.split(/\s+/).pop() || '';
  return last === s || name.includes(s);
}

function fromCheckinData(ref: string): Partial<GuestBooking> | null {
  try {
    const data = JSON.parse(fs.readFileSync(CHECKIN_DATA, 'utf8'));
    const key = Object.keys(data).find((k) => k.trim().toLowerCase() === ref.trim().toLowerCase());
    if (!key) return null;
    const r = data[key];
    return {
      ref: key,
      guestName: r.guestName || '',
      checkIn: r.checkIn || '',
      checkOut: r.checkOut || '',
      room: r.roomNumber || null,
      arrivalTime: r.arrivalTime || null,
      lockCode: r.lockCode || null,
      stripeLink: r.stripeLink || null,
      stripeStatus: r.stripeStatus || null,
    };
  } catch {
    return null;
  }
}

function csvParse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f.trim() !== '')) rows.push(row); }
  return rows;
}

function fromReservationStatus(ref: string): Partial<GuestBooking> | null {
  try {
    const rows = csvParse(fs.readFileSync(RES_STATUS, 'utf8'));
    const h = rows[0];
    const c = (name: string) => h.indexOf(name);
    const iRef = c('Booking reference');
    for (const r of rows.slice(1)) {
      if ((r[iRef] || '').trim().toLowerCase() !== ref.trim().toLowerCase()) continue;
      if ((r[c('Status')] || '').trim().toLowerCase() === 'cancelled') return null;
      const name =
        [r[c('Guest first name')], r[c('Guest last name')]].filter(Boolean).join(' ').trim() ||
        (r[c('Guest Name')] || '').trim();
      return {
        ref: (r[iRef] || '').trim(),
        guestName: name,
        checkIn: (r[c('Check in date')] || '').trim(),
        checkOut: (r[c('Check out date')] || '').trim(),
        room: (r[c('Rooms')] || '').trim() || null,
        arrivalTime: (r[c('Arrival time')] || '').trim() || null,
        lockCode: null,
      };
    }
  } catch { /* fall through */ }
  return null;
}

async function fromChannelManager(ref: string): Promise<Partial<GuestBooking> | null> {
  try {
    const db = createClient({ url: `file:${CM_DB}` });
    const rs = await db.execute({
      sql: `SELECT guestName, checkIn, checkOut, physicalRoom, channelRef FROM Booking
            WHERE status = 'confirmed' AND channelRef = ? COLLATE NOCASE ORDER BY checkIn LIMIT 1`,
      args: [ref.trim()],
    });
    if (!rs.rows.length) return null;
    const r = rs.rows[0] as any;
    return {
      ref: r.channelRef,
      guestName: r.guestName,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      room: r.physicalRoom ? `Room ${r.physicalRoom}` : null,
      arrivalTime: null,
      lockCode: null,
    };
  } catch {
    return null;
  }
}

// Lookup without the surname check — for already-authenticated sessions only.
export async function findBookingByRef(ref: string): Promise<GuestBooking | null> {
  const sources = [fromCheckinData(ref), fromReservationStatus(ref), await fromChannelManager(ref)];
  const found = sources.filter(Boolean) as Partial<GuestBooking>[];
  if (!found.length) return null;
  // merge: first source wins per field (checkin_data has the lock code)
  const merged: GuestBooking = {
    ref, guestName: '', checkIn: '', checkOut: '', room: null, arrivalTime: null, lockCode: null,
    stripeLink: null, stripeStatus: null,
  };
  for (const f of found) {
    merged.ref = merged.ref || f.ref || ref;
    merged.guestName = merged.guestName || f.guestName || '';
    merged.checkIn = merged.checkIn || f.checkIn || '';
    merged.checkOut = merged.checkOut || f.checkOut || '';
    merged.room = merged.room || f.room || null;
    merged.arrivalTime = merged.arrivalTime || f.arrivalTime || null;
    merged.lockCode = merged.lockCode || f.lockCode || null;
    merged.stripeLink = merged.stripeLink || f.stripeLink || null;
    merged.stripeStatus = merged.stripeStatus || f.stripeStatus || null;
  }
  return merged;
}

export async function findGuestBooking(ref: string, surname: string): Promise<GuestBooking | null> {
  const merged = await findBookingByRef(ref);
  if (!merged || !surnameMatches(merged.guestName, surname)) return null;
  return merged;
}

// Login by guest details: first name + last name + exact check-in/check-out.
// Searches checkin_data.json, reservation_status.csv and the channel-manager
// DB; returns the merged booking (so the door code comes along when present).
export async function findGuestBookingByDetails(
  firstName: string,
  lastName: string,
  checkIn: string,
  checkOut: string
): Promise<GuestBooking | null> {
  const f = firstName.trim().toLowerCase();
  const l = lastName.trim().toLowerCase();
  if (f.length < 1 || l.length < 2) return null;
  const nameMatch = (n: string) => {
    const s = (n || '').toLowerCase();
    return s.includes(f) && s.includes(l);
  };

  // 1. checkin_data.json (keyed by booking ref)
  try {
    const data = JSON.parse(fs.readFileSync(CHECKIN_DATA, 'utf8'));
    for (const [key, r] of Object.entries<any>(data)) {
      if (r?.checkIn === checkIn && r?.checkOut === checkOut && nameMatch(r?.guestName)) {
        return (await findBookingByRef(key)) ?? null;
      }
    }
  } catch { /* next source */ }

  // 2. reservation_status.csv
  try {
    const rows = csvParse(fs.readFileSync(RES_STATUS, 'utf8'));
    const h = rows[0];
    const c = (name: string) => h.indexOf(name);
    for (const r of rows.slice(1)) {
      if ((r[c('Status')] || '').trim().toLowerCase() === 'cancelled') continue;
      const ciRaw = (r[c('Check in date')] || '').trim();
      const coRaw = (r[c('Check out date')] || '').trim();
      if (ciRaw !== checkIn || coRaw !== checkOut) continue;
      const name =
        [r[c('Guest first name')], r[c('Guest last name')]].filter(Boolean).join(' ').trim() ||
        (r[c('Guest Name')] || '').trim();
      if (!nameMatch(name)) continue;
      const ref = (r[c('Booking reference')] || '').trim();
      if (ref) return (await findBookingByRef(ref)) ?? null;
    }
  } catch { /* next source */ }

  // 3. channel-manager DB (direct bookings)
  try {
    const db = createClient({ url: `file:${CM_DB}` });
    const rs = await db.execute({
      sql: `SELECT guestName, channelRef FROM Booking
            WHERE status = 'confirmed' AND checkIn = ? AND checkOut = ? AND channelRef IS NOT NULL`,
      args: [checkIn, checkOut],
    });
    for (const r of rs.rows as any[]) {
      if (nameMatch(r.guestName)) return (await findBookingByRef(r.channelRef)) ?? null;
    }
  } catch { /* not found */ }

  return null;
}

// ---------- session token (HMAC-signed, httpOnly cookie) ----------

export const PORTAL_COOKIE = 'guest_session';

export function makeToken(ref: string): string {
  const exp = Date.now() + 7 * 24 * 3600 * 1000; // 7 days
  const payload = `${ref}|${exp}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

export function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const [ref, expStr, sig] = Buffer.from(token, 'base64url').toString().split('|');
    if (!ref || !expStr || !sig) return null;
    if (Number(expStr) < Date.now()) return null;
    const expect = crypto.createHmac('sha256', SECRET).update(`${ref}|${expStr}`).digest('hex').slice(0, 32);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    return ref;
  } catch {
    return null;
  }
}

// ---------- extras requests ledger ----------

export type ExtraRequest = {
  id: string; // request id
  ref: string; // booking ref
  guestName: string;
  extraId: string;
  extraName: string;
  date: string | null;
  time: string | null;
  nights: number | null;
  price: number;
  status: 'requested' | 'confirmed' | 'pending-payment' | 'paid';
  stripeSession: string | null;
  createdAt: string;
};

// CSV mirror of the requests ledger — easy pickup for the CRM / channel-manager
// agent (one row per request, appended on every change).
const REQUESTS_CSV = path.join(process.cwd(), '.data', 'extras-requests.csv');

function writeCsvMirror(all: ExtraRequest[]) {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = 'request_id,booking_reference,guest_name,extra_id,extra_name,date,time,nights,price_gbp,status,stripe_session,created_at';
  const lines = all.map((r) =>
    [r.id, r.ref, r.guestName, r.extraId, r.extraName, r.date, r.time, r.nights, r.price.toFixed(2), r.status, r.stripeSession, r.createdAt]
      .map(esc).join(',')
  );
  try { fs.writeFileSync(REQUESTS_CSV, [header, ...lines].join('\n') + '\n'); } catch { /* mirror is best-effort */ }
}

function readRequests(): ExtraRequest[] {
  try { return JSON.parse(fs.readFileSync(REQUESTS, 'utf8')); } catch { return []; }
}

function writeRequests(all: ExtraRequest[]) {
  fs.mkdirSync(path.dirname(REQUESTS), { recursive: true });
  fs.writeFileSync(REQUESTS, JSON.stringify(all, null, 2));
  writeCsvMirror(all);
  triggerInstantImport();
}

// INSTANT hand-off: the moment a request is created/paid, run the
// channel-manager's import (idempotent; the 15-min poll stays as safety net).
// Fire-and-forget so the guest's request never waits on it.
function triggerInstantImport() {
  try {
    const cmDir = path.dirname(path.dirname(CM_DB)); // .../channel-manager/db/dev.db → .../channel-manager
    const script = path.join(cmDir, 'db', 'import-extras.mjs');
    if (!fs.existsSync(script)) return;
    spawn(process.execPath, [script, REQUESTS_CSV], { cwd: cmDir, detached: true, stdio: 'ignore' }).unref();
  } catch { /* poll job will pick it up */ }
}

export function addRequest(r: Omit<ExtraRequest, 'id' | 'createdAt'>): ExtraRequest {
  const all = readRequests();
  const req: ExtraRequest = {
    ...r,
    id: `EXT-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };
  all.push(req);
  writeRequests(all);
  return req;
}

export function markRequestPaid(stripeSession: string): ExtraRequest | null {
  const all = readRequests();
  const req = all.find((r) => r.stripeSession === stripeSession);
  if (!req) return null;
  if (req.status !== 'paid') { req.status = 'paid'; writeRequests(all); }
  return req;
}

// Marks ALL requests sharing a session ID (e.g. combined checkin-extras checkout).
export function markAllRequestsPaid(stripeSession: string): ExtraRequest[] {
  const all = readRequests();
  const matched = all.filter((r) => r.stripeSession === stripeSession);
  let changed = false;
  for (const req of matched) {
    if (req.status !== 'paid') { req.status = 'paid'; changed = true; }
  }
  if (changed) writeRequests(all);
  return matched;
}

export function requestsForBooking(ref: string): ExtraRequest[] {
  return readRequests().filter((r) => r.ref.toLowerCase() === ref.toLowerCase() && r.status !== 'pending-payment');
}
