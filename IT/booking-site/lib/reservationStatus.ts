// Reads the LATEST reservation data from the TTLock pipeline export
// (reservation_status.csv) so room-switch quotes never rely on a stale DB
// import. Rows are merged with channel-manager bookings in switchQuote.ts,
// deduped by booking reference — the file wins.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATH =
  '/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/automation-data/reservation_status.csv';

export type FileReservation = {
  ref: string | null;
  room: string | null; // physical room number, e.g. '9'
  checkIn: string; // YYYY-MM-DD
  checkOut: string;
  typeName: string | null; // canonical channel-manager room type name, if resolvable
};

// Little Hotelier / Expedia / canonical names → canonical room type names
// (same aliases as channel-manager/db/import-reservation-status.mjs).
const STREATHAM_TYPE_ALIASES: Record<string, string> = {
  'triple room with private bathroom': 'Triple Room with Private Bathroom',
  'executive house, accessible, ensuite': 'Triple Room with Private Bathroom',
  'quad room, with shared bathroom': 'Quad room, with Shared Bathroom',
  'quadruple room with shared bathroom': 'Quad room, with Shared Bathroom',
  'quadruple room, shared bathroom': 'Quad room, with Shared Bathroom',
  'superior king or twin room': 'Superior King or Twin Room',
  'superior king or twin room, with private bathroom': 'Superior King or Twin Room',
  'super king or twin room': 'Superior King or Twin Room',
  'executive house, shared bathroom': 'Superior King or Twin Room',
  'double or twin room with private bathroom': 'Double or Twin Room with Private Bathroom',
  'double room with private bathroom': 'Double or Twin Room with Private Bathroom',
  'comfort twin room, ensuite': 'Double or Twin Room with Private Bathroom',
  'double room-ensuite': 'Double room-Ensuite',
  'double room, ensuite': 'Double room-Ensuite',
  'twin room, with full private kitchen and ensuite': 'Twin Room, with full private kitchen and ensuite',
  'deluxe apartment': 'Twin Room, with full private kitchen and ensuite',
  'luxury apartment, private bathroom': 'Twin Room, with full private kitchen and ensuite',
  'basic single room with shared bathroom': 'Basic Single Room with Shared Bathroom',
  'single room with shared bathroom': 'Basic Single Room with Shared Bathroom',
  'single room, shared bathroom (single bed)': 'Basic Single Room with Shared Bathroom',
};

function parseCsv(text: string): string[][] {
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

function iso(d: string): string {
  d = (d || '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const [dd, mm, yyyy] = d.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

// Streatham reservations from the latest reservation_status export.
// Returns null if the file can't be read (caller falls back to DB only).
export function readReservationStatus(): FileReservation[] | null {
  const file = process.env.RESERVATION_STATUS_PATH || DEFAULT_PATH;
  let text: string;
  try {
    text = fs.readFileSync(path.resolve(file), 'utf8');
  } catch {
    return null;
  }
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  const col = (name: string) => header.indexOf(name);
  const iProp = col('Property name');
  const iCi = col('Check in date');
  const iCo = col('Check out date');
  const iStatus = col('Status');
  const iRooms = col('Rooms');
  const iRef = col('Booking reference');
  const iTypes = col('Room types');
  if (iProp < 0 || iCi < 0 || iCo < 0) return null;

  const out: FileReservation[] = [];
  for (const r of rows.slice(1)) {
    if ((r[iProp] || '').trim() !== 'Streatham Rooms') continue;
    const status = (r[iStatus] || '').trim().toLowerCase();
    if (status === 'cancelled') continue; // everything else counts as confirmed (importer behaviour)
    const checkIn = iso(r[iCi]);
    const checkOut = iso(r[iCo]);
    if (!checkIn || !checkOut || checkOut <= checkIn) continue;

    const ref = (r[iRef] || '').trim() || null;
    const rawType = ((r[iTypes] || '').split(',')[0] || '').trim().toLowerCase();
    const typeName = STREATHAM_TYPE_ALIASES[rawType] || null;

    const roomsField = (r[iRooms] || '').trim();
    const rooms =
      !roomsField || roomsField.toUpperCase() === 'UNALLOCATED'
        ? [null]
        : roomsField.split(',').map((s) => s.trim().replace(/^Room\s+/i, '')).filter(Boolean);
    for (const room of rooms) out.push({ ref, room, checkIn, checkOut, typeName });
  }
  return out;
}
