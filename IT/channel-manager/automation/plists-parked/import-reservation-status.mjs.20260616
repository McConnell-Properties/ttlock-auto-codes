// Import from automation-data/reservation_status.csv (the TTLock pipeline export).
// Rich source: guest, channel, booking ref, payment, status, physical room.
// Replaces earlier imports: deletes existing bookings with matching channelRef,
// plus the legacy channel='import' rows (superseded bare-bones import).
// Does NOT queue sync jobs — these bookings are already reflected on the OTAs.
//
//   node db/import-reservation-status.mjs [csvPath]
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const csvPath = process.argv[2] || join(here, 'reservation_status.csv');

// --- tiny CSV parser (handles quoted fields with commas/newlines) ---
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
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
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const PROPERTY_MAP = {
  'Streatham Rooms': 'streatham',
  'Gassiot House': 'gassiot',
  'Tooting Stays': 'tooting',
  'Valnay Stays': 'valnay',
  'Seamless Stays': 'seamless',
  'Flat': 'flat',
};

function normChannel(c) {
  const x = (c || '').toLowerCase();
  if (x.includes('booking')) return 'booking.com';
  if (x.includes('expedia')) return 'expedia';
  if (x.includes('airbnb')) return 'airbnb';
  if (x.includes('direct') || x.includes('mobile')) return 'direct';
  if (!x) return 'unknown';
  return x; // extranet, import, ...
}

function iso(d) {
  d = (d || '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const [dd, mm, yyyy] = d.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

// Ensure Flat property + its room exists
await db.execute(`INSERT INTO Property (id, name, sortOrder) VALUES ('flat', 'Flat', 6)
                  ON CONFLICT(id) DO NOTHING`);
const flatRt = await db.execute(`SELECT id FROM RoomType WHERE propertyId = 'flat' AND name = 'Room 1'`);
if (flatRt.rows.length === 0) {
  await db.execute(`INSERT INTO RoomType (propertyId, name, physicalRooms, totalUnits) VALUES ('flat', 'Room 1', '1', 1)`);
}

// room maps per property
const roomTypes = (await db.execute(`SELECT id, propertyId, name, expediaName, physicalRooms FROM RoomType`)).rows;
const roomToType = new Map(); // 'propertyId|roomNo' -> roomTypeId
const nameToType = new Map(); // 'propertyId|name(lower)' -> roomTypeId (canonical + expedia names)
for (const rt of roomTypes) {
  for (const r of String(rt.physicalRooms).split(',')) {
    roomToType.set(`${rt.propertyId}|${r.trim()}`, rt.id);
  }
  nameToType.set(`${rt.propertyId}|${String(rt.name).toLowerCase()}`, rt.id);
  if (rt.expediaName) nameToType.set(`${rt.propertyId}|${String(rt.expediaName).toLowerCase()}`, rt.id);
}

// Little Hotelier room-type names that match neither canonical nor Expedia names
const LH_ALIASES = {
  'streatham|deluxe apartment': 'Twin Room, with full private kitchen and ensuite', // Room 9
  'streatham|superior king or twin room, with private bathroom': 'Superior King or Twin Room',
  'streatham|super king or twin room': 'Superior King or Twin Room',
  'streatham|double room with private bathroom': 'Double or Twin Room with Private Bathroom',
  'streatham|quadruple room with shared bathroom': 'Quad room, with Shared Bathroom',
  'streatham|single room with shared bathroom': 'Basic Single Room with Shared Bathroom',
  'gassiot|twin room with shared bathroom': 'Twin or Super King Bed in Cozy Room (Shared Bath)',
  'gassiot|budget twin room': 'Twin or Super King Bed in Cozy Room (Shared Bath)',
  'gassiot|double room with shared bathroom': 'Double Room, Shared Bathroom',
  'gassiot|basic double room with shared bathroom': 'Basic Double Room with Shared Bathroom',
  'gassiot|single room with shared bathroom': 'Single Room, Shared bathroom',
  'tooting|deluxe double room': 'Room 6',
  'valnay|double room shared bathroom': 'Double Room, Shared Bathroom',
  'valnay|twin room with private bathroom': 'Twin Room/ Super King Bed, with En-suite',
  // unresolvable (flag, leave untyped): tooting 'business double room', gassiot 'one-bedroom house', flat 'flat'
};
function resolveType(propertyId, lhName) {
  const key = `${propertyId}|${(lhName || '').toLowerCase().trim()}`;
  if (nameToType.has(key)) return nameToType.get(key);
  const alias = LH_ALIASES[key];
  if (alias) return nameToType.get(`${propertyId}|${alias.toLowerCase()}`) ?? null;
  return null;
}

const records = parseCsv(readFileSync(csvPath, 'utf8'));
console.log(`parsed ${records.length} records`);

// snapshot old Streatham import for coverage diff
const oldImport = (await db.execute(
  `SELECT physicalRoom, checkIn, checkOut FROM Booking WHERE channel = 'import' AND propertyId = 'streatham' AND status = 'confirmed' AND checkOut > date('now')`
)).rows.map((r) => ({ ...r }));

// wipe: legacy bare-bones import + any previous run of this importer
// (keeps the 5 'VERIFY against extranet' rows recovered from the old sheet)
await db.execute(`DELETE FROM Booking WHERE channel = 'import' AND (notes IS NULL OR notes NOT LIKE '%VERIFY%')`);
await db.execute(`DELETE FROM Booking WHERE channelRef IS NOT NULL AND notes LIKE '%[reservation_status]%'`);

let imported = 0, cancelled = 0, unallocated = 0, skipped = 0, statusMissing = 0;
const newStays = new Set(); // 'room|ci|co' for streatham diff

for (const r of records) {
  const propertyId = PROPERTY_MAP[r['Property name']];
  if (!propertyId) { skipped++; continue; }
  const ci = iso(r['Check in date']);
  const co = iso(r['Check out date']);
  if (!ci || !co || co <= ci) { skipped++; console.warn(`skip ${r['Booking reference']}: bad dates '${r['Check in date']}'→'${r['Check out date']}'`); continue; }

  let status = (r['Status'] || '').toLowerCase();
  let note = '[reservation_status]';
  if (!status) { status = 'confirmed'; statusMissing++; note += ' status missing in source;'; }
  if (status !== 'confirmed' && status !== 'cancelled') status = 'confirmed';

  const roomsField = (r['Rooms'] || '').trim();
  const roomNames = !roomsField || roomsField === 'UNALLOCATED'
    ? [null]
    : roomsField.split(',').map((s) => s.trim().replace(/^Room\s+/i, ''));

  const guestName = [r['Guest first name'], r['Guest last name']].filter(Boolean).join(' ')
    || r['Guest Name'] || 'Guest';
  const total = parseFloat(r['Payment total']) || null;

  let first = true;
  for (const room of roomNames) {
    let roomTypeId = null;
    let physicalRoom = null;
    let n = note;
    if (room) {
      const rtId = roomToType.get(`${propertyId}|${room}`);
      if (rtId) { roomTypeId = rtId; physicalRoom = room; }
      else n += ` unknown room '${room}' — left unallocated;`;
    }
    if (!physicalRoom) {
      // No physical room — at least pin the room TYPE from LH's "Room types" column
      roomTypeId = resolveType(propertyId, (r['Room types'] || '').split(',')[0]) ?? roomTypeId;
      if (status === 'confirmed') {
        n += roomTypeId
          ? ' UNASSIGNED — needs a room within its type;'
          : ` UNASSIGNED — room type '${r['Room types']}' not recognised;`;
      }
    }
    await db.execute({
      sql: `INSERT INTO Booking (propertyId, roomTypeId, physicalRoom, guestName, email, phone, checkIn, checkOut, units, channel, channelRef, totalPrice, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      args: [propertyId, roomTypeId, physicalRoom, guestName, r['Guest email'] || null, r['Guest phone number'] || null,
             ci, co, normChannel(r['Channel name']), r['Booking reference'] || null,
             first ? total : null, status, n],
    });
    first = false;
    if (status === 'cancelled') cancelled++;
    else {
      imported++;
      if (!physicalRoom) unallocated++;
      if (propertyId === 'streatham' && physicalRoom) newStays.add(`${physicalRoom}|${ci}|${co}`);
    }
  }
}

console.log(`imported ${imported} confirmed (+${cancelled} cancelled for history), ${unallocated} unallocated, ${skipped} skipped, ${statusMissing} had missing status`);

// coverage diff vs old Streatham import
const lost = oldImport.filter((o) => o.physicalRoom && !newStays.has(`${o.physicalRoom}|${o.checkIn}|${o.checkOut}`));
if (lost.length) {
  console.log(`\nCOVERAGE DIFF — ${lost.length} future Streatham stays were in the old sheet but NOT in this file:`);
  lost.forEach((o) => console.log(` - Room ${o.physicalRoom}: ${o.checkIn} → ${o.checkOut}`));
} else {
  console.log('\nCoverage diff: every future Streatham stay from the old sheet is present in this file. ✓');
}
db.close();
