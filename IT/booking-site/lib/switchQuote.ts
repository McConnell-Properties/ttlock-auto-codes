// Room-switching quotes: when no single room covers the whole stay, we export
// LIVE reservations from the channel-manager DB into the quote.py data format,
// run `python3 quote.py`, and return the Pareto-optimal switching plans.
//
// quote.py looks for ./data relative to its cwd, so we build a fresh temp dir
// per request: data/{rooms,discounts}.csv copied from the quote tool,
// data/{reservations,pricing}.csv generated from the live DB.
import { createClient } from '@libsql/client';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readReservationStatus } from './reservationStatus';

const QUOTE_DIR = path.resolve(process.cwd(), process.env.QUOTE_DIR || '../../special quote');
const CM_DB = path.resolve(process.cwd(), process.env.CM_DB_PATH || '../channel-manager/db/dev.db');
const PYTHON = process.env.PYTHON_BIN || 'python3';

export type Segment = { room: string; start: string; end: string; price: number };
export type SwitchPlan = {
  plan: string;
  switches: number;
  totalPrice: number;
  fullPrice: number;
  preferredNights: number;
  label: string;
  segmentDetail: string;
  warning: string;
  segments: Segment[];
};

type DbRoomType = { id: number; name: string; physicalRooms: string; basePrice: number };
type DbBooking = {
  roomTypeId: number | null;
  physicalRoom: string | null;
  checkIn: string;
  checkOut: string;
  units: number;
  channelRef: string | null;
};

function nights(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const d = new Date(checkIn + 'T00:00:00Z');
  while (d.toISOString().slice(0, 10) < checkOut) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const overlaps = (aIn: string, aOut: string, bIn: string, bOut: string) => aIn < bOut && bIn < aOut;

export async function getSwitchPlans(opts: {
  checkIn: string;
  checkOut: string;
  guests: number;
  prefer: 'bathroom' | 'kitchen' | 'none';
  minBeds?: number;
  propertyId?: string;
}): Promise<{ plans: SwitchPlan[]; error?: string }> {
  // Room switching is only supported for Streatham (physical room config, quote.py data).
  if (opts.propertyId && opts.propertyId !== 'streatham') return { plans: [] };
  const db = createClient({ url: `file:${CM_DB}` });
  const roomTypes = (
    await db.execute("SELECT id, name, physicalRooms, basePrice FROM RoomType WHERE propertyId = 'streatham'")
  ).rows as unknown as DbRoomType[];
  let bookings = (
    await db.execute({
      sql: `SELECT roomTypeId, physicalRoom, checkIn, checkOut, units, channelRef FROM Booking
            WHERE propertyId = 'streatham' AND status = 'confirmed' AND checkOut > ? AND checkIn < ?`,
      args: [opts.checkIn, opts.checkOut],
    })
  ).rows as unknown as DbBooking[];

  // Latest reservation data: reservation_status.csv (the TTLock pipeline
  // export) is fresher than the DB import. Use its rows as the authority for
  // OTA reservations; keep DB bookings the file doesn't know about (direct
  // site bookings, manual admin entries) — dedupe by booking reference.
  const fileRows = readReservationStatus();
  const typeIdByName = new Map(roomTypes.map((rt) => [rt.name, rt.id]));
  if (fileRows) {
    const fileRefs = new Set(fileRows.map((f) => f.ref).filter(Boolean));
    bookings = bookings.filter((b) => !b.channelRef || !fileRefs.has(b.channelRef));
    for (const f of fileRows) {
      if (!(f.checkIn < opts.checkOut && opts.checkIn < f.checkOut)) continue;
      bookings.push({
        roomTypeId: f.typeName ? typeIdByName.get(f.typeName) ?? null : null,
        physicalRoom: f.room,
        checkIn: f.checkIn,
        checkOut: f.checkOut,
        units: 1,
        channelRef: f.ref,
      });
    }
  }
  const blocks = (
    await db.execute({
      sql: `SELECT b.roomTypeId, b.date, b.units FROM Block b JOIN RoomType rt ON rt.id = b.roomTypeId
            WHERE rt.propertyId = 'streatham' AND b.date >= ? AND b.date < ?`,
      args: [opts.checkIn, opts.checkOut],
    })
  ).rows as unknown as { roomTypeId: number; date: string; units: number }[];

  const roomsOfType = new Map<number, string[]>();
  for (const rt of roomTypes)
    roomsOfType.set(rt.id, String(rt.physicalRooms).split(',').map((s) => s.trim()).filter(Boolean));

  // Build reservation rows. Bookings with a physical room block that room directly.
  // Bookings with only a room TYPE still consume a unit — virtually allocate them
  // to a free physical room of that type so quote.py sees true occupancy.
  const rows: { room: string | null; checkIn: string; checkOut: string }[] = [];
  const allocated: { room: string; checkIn: string; checkOut: string }[] = [];
  const isFree = (room: string, ci: string, co: string) =>
    !rows.some((r) => r.room === room && overlaps(r.checkIn, r.checkOut, ci, co)) &&
    !allocated.some((r) => r.room === room && overlaps(r.checkIn, r.checkOut, ci, co));

  for (const b of bookings.filter((b) => b.physicalRoom)) {
    for (let u = 0; u < (b.units || 1); u++) rows.push({ room: String(b.physicalRoom), checkIn: b.checkIn, checkOut: b.checkOut });
  }
  for (const b of bookings.filter((b) => !b.physicalRoom)) {
    const candidates = b.roomTypeId ? roomsOfType.get(b.roomTypeId) || [] : [];
    for (let u = 0; u < (b.units || 1); u++) {
      const free = candidates.find((room) => isFree(room, b.checkIn, b.checkOut));
      if (free) allocated.push({ room: free, checkIn: b.checkIn, checkOut: b.checkOut });
      else rows.push({ room: null, checkIn: b.checkIn, checkOut: b.checkOut }); // UNALLOCATED → warning
    }
  }
  for (const a of allocated) rows.push({ room: a.room, checkIn: a.checkIn, checkOut: a.checkOut });
  // Manual blocks: occupy a free room of the type for that night.
  for (const bl of blocks) {
    const candidates = roomsOfType.get(bl.roomTypeId) || [];
    const next = new Date(bl.date + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    const end = next.toISOString().slice(0, 10);
    for (let u = 0; u < (bl.units || 1); u++) {
      const free = candidates.find((room) => isFree(room, bl.date, end));
      if (free) rows.push({ room: free, checkIn: bl.date, checkOut: end });
    }
  }

  // Pricing per physical room = its room type's rate (override or base).
  const stayNights = nights(opts.checkIn, opts.checkOut);
  const rates = (
    await db.execute({
      sql: `SELECT r.roomTypeId, r.date, r.price FROM RateOverride r JOIN RoomType rt ON rt.id = r.roomTypeId
            WHERE rt.propertyId = 'streatham' AND r.date >= ? AND r.date < ?`,
      args: [opts.checkIn, opts.checkOut],
    })
  ).rows as unknown as { roomTypeId: number; date: string; price: number }[];
  const typeOfRoom = new Map<string, DbRoomType>();
  for (const rt of roomTypes) for (const room of roomsOfType.get(rt.id)!) typeOfRoom.set(room, rt);

  // ---- write temp data dir ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-quote-'));
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.copyFileSync(path.join(QUOTE_DIR, 'data', 'rooms.csv'), path.join(dataDir, 'rooms.csv'));
  fs.copyFileSync(path.join(QUOTE_DIR, 'data', 'discounts.csv'), path.join(dataDir, 'discounts.csv'));

  const resLines = ['Room,Check in,Check out'];
  for (const r of rows)
    resLines.push(r.room ? `Room ${r.room},${r.checkIn},${r.checkOut}` : `UNALLOCATED,${r.checkIn},${r.checkOut}`);
  fs.writeFileSync(path.join(dataDir, 'reservations.csv'), resLines.join('\n') + '\n');

  const roomNums = Array.from({ length: 11 }, (_, i) => String(i + 1));
  const priceLines = ['Rooms,' + roomNums.join(',')];
  for (const date of stayNights) {
    const cells = roomNums.map((room) => {
      const rt = typeOfRoom.get(room);
      if (!rt) return '0';
      const o = rates.find((r) => r.roomTypeId === rt.id && r.date === date);
      return String(o ? o.price : rt.basePrice);
    });
    priceLines.push(`${date},${cells.join(',')}`);
  }
  fs.writeFileSync(path.join(dataDir, 'pricing.csv'), priceLines.join('\n') + '\n');

  // ---- run quote.py ----
  const outCsv = path.join(tmp, 'out.csv');
  const args = [
    path.join(QUOTE_DIR, 'quote.py'),
    opts.checkIn,
    opts.checkOut,
    '--guests', String(opts.guests),
    '--prefer', opts.prefer,
    '-o', outCsv,
  ];
  if (opts.minBeds && opts.minBeds > 1) args.push('--min-beds', String(opts.minBeds));

  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(PYTHON, args, { cwd: tmp });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    p.on('error', (e) => resolve({ code: 1, stdout, stderr: String(e) }));
  });

  try {
    if (result.code !== 0 || !fs.existsSync(outCsv)) {
      const msg = (result.stdout + '\n' + result.stderr).trim();
      return { plans: [], error: msg.split('\n').slice(-3).join(' ') || 'quote tool failed' };
    }
    const plans = parseQuoteCsv(fs.readFileSync(outCsv, 'utf8'), opts.checkIn, opts.checkOut);
    return { plans: plans.slice(0, 8) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- CSV parsing ----

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
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

// "Jun 19" → YYYY-MM-DD within [checkIn, checkOut] (handles year boundary).
function resolveDate(mon: string, day: string, checkIn: string, checkOut: string): string {
  const baseYear = Number(checkIn.slice(0, 4));
  for (const y of [baseYear, baseYear + 1]) {
    const iso = `${y}-${String(MONTHS[mon]).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
    if (iso >= checkIn && iso <= checkOut) return iso;
  }
  return `${baseYear}-${String(MONTHS[mon]).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
}

function parseQuoteCsv(text: string, checkIn: string, checkOut: string): SwitchPlan[] {
  const rows = parseCsv(text.trim());
  if (rows.length < 2) return [];
  const header = rows[0];
  const idx = (names: string[]) => header.findIndex((h) => names.some((n) => h.toLowerCase().startsWith(n)));
  const iPlan = idx(['plan']);
  const iSw = idx(['switches']);
  const iTotal = idx(['total_price']);
  const iFull = idx(['full_price']);
  const iPref = idx(['preferred_nights']);
  const iDetail = idx(['segment_detail']);
  const iLabel = idx(['label']);
  const iWarn = idx(['warning']);

  const plans: SwitchPlan[] = [];
  for (const r of rows.slice(1)) {
    if (!r[iPlan]) continue;
    const totalPrice = parseFloat(r[iTotal]) || 0;
    const fullPrice = parseFloat(r[iFull]) || 0;

    // segments from the plan string: "Room 9 (Jun 19–Jun 22) → Room 2 (Jun 22–Jun 26)"
    const segs: Segment[] = [];
    const re = /Room\s+(\d+)\s*\(([A-Za-z]{3})\s+(\d+)\s*[–-]\s*([A-Za-z]{3})\s+(\d+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(r[iPlan])) !== null) {
      segs.push({
        room: m[1],
        start: resolveDate(m[2], m[3], checkIn, checkOut),
        end: resolveDate(m[4], m[5], checkIn, checkOut),
        price: 0,
      });
    }
    if (segs.length) { segs[0].start = checkIn; segs[segs.length - 1].end = checkOut; }

    // apportion the discounted total across segments by undiscounted share
    const detail = iDetail >= 0 ? r[iDetail] : '';
    const segPrices = Array.from(detail.matchAll(/=\s*£([\d,]+\.?\d*)/g)).map((x) => parseFloat(x[1].replace(/,/g, '')));
    if (segPrices.length === segs.length && fullPrice > 0) {
      let assigned = 0;
      segs.forEach((s, i) => {
        if (i === segs.length - 1) s.price = Math.round((totalPrice - assigned) * 100) / 100;
        else {
          s.price = Math.round(totalPrice * (segPrices[i] / fullPrice) * 100) / 100;
          assigned += s.price;
        }
      });
    } else if (segs.length === 1) segs[0].price = totalPrice;

    plans.push({
      plan: r[iPlan],
      switches: Number(r[iSw]) || 0,
      totalPrice,
      fullPrice,
      preferredNights: iPref >= 0 ? Number(r[iPref]) || 0 : 0,
      label: iLabel >= 0 ? r[iLabel] : '',
      segmentDetail: detail,
      warning: iWarn >= 0 ? r[iWarn] : '',
      segments: segs,
    });
  }
  return plans;
}
