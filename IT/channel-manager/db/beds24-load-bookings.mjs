// Initial one-time load of non-BDC bookings into Beds24.
// Sends direct, Expedia, Airbnb, LittleHotelier, and other non-BDC confirmed
// future bookings to POST /bookings so Beds24's calendar shows true availability
// before go-live activation.
//
// BDC bookings are deliberately excluded — they will be imported via the
// Beds24 UI "Import Existing Bookings" step (go-live Priority 3 / Step 7).
// "unknown" channel bookings with BDC- refs are also excluded for the same reason.
//
// Usage:
//   node db/beds24-load-bookings.mjs           # live run — posts to Beds24
//   node db/beds24-load-bookings.mjs --dry-run # print payloads, no POST
//
// Idempotency: after each successful POST the Beds24 booking ID is recorded in
//   automation/logs/beds24-booking-load.json   ({hubId, beds24Id} pairs)
// Re-running skips any hub booking ID already present in that log.
//
// ⚠️  ONE-SHOT SCRIPT. Verify the log before re-running to avoid duplicates.
//
// Requires: BEDS24_REFRESH_TOKEN, DATABASE_URL, DATABASE_AUTH_TOKEN in .env

import { createClient } from '@libsql/client';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes('--dry-run');

// ── .env loader ───────────────────────────────────────────────────────────────
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const db = createClient({
  url: (process.env.DATABASE_URL || `file:${join(here, 'dev.db')}`),
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

// ── Idempotency log ───────────────────────────────────────────────────────────
const LOG_DIR = join(here, '..', 'automation', 'logs');
const LOG_PATH = join(LOG_DIR, 'beds24-booking-load.json');

function loadLog() {
  if (!existsSync(LOG_PATH)) return {};
  try { return JSON.parse(readFileSync(LOG_PATH, 'utf8')); } catch { return {}; }
}

function saveLog(log) {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

// ── Beds24 client (inline — no TS import possible from .mjs) ──────────────────
const B24_BASE = 'https://api.beds24.com/v2';
let _b24Token = null;
let _b24TokenExp = 0;

async function getB24Token() {
  if (_b24Token && _b24TokenExp - Date.now() > 5 * 60 * 1000) return _b24Token;
  const refreshTok = process.env.BEDS24_REFRESH_TOKEN;
  if (!refreshTok) throw new Error('BEDS24_REFRESH_TOKEN not set');
  const res = await fetch(`${B24_BASE}/authentication/token`, {
    headers: { refreshToken: refreshTok },
  });
  if (!res.ok) throw new Error(`Beds24 token refresh failed: HTTP ${res.status}`);
  const data = await res.json();
  _b24Token = data.token;
  _b24TokenExp = Date.now() + data.expiresIn * 1000;
  return _b24Token;
}

async function b24Post(path, body) {
  const token = await getB24Token();
  const res = await fetch(`${B24_BASE}${path}`, {
    method: 'POST',
    headers: { token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const remaining = Number(res.headers.get('x-five-min-limit-remaining') ?? 100);
  const cost = res.headers.get('x-request-cost') ?? '?';
  const tag = remaining < 20 ? '[BEDS24 RATE LOW]' : '[beds24]';
  console.log(`  ${tag} POST ${path} cost=${cost} remaining=${remaining}`);

  if (remaining < 20) {
    console.log('  Rate limit low — backing off 90s...');
    await new Promise(r => setTimeout(r, 90_000));
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Beds24 POST ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ── Channel → Beds24 referer mapping ─────────────────────────────────────────
// Maps our internal channel strings to a human-readable source string in Beds24.
// Beds24 uses "referer" as a free-text channel label for manually-entered bookings.
function mapChannel(channel, channelRef) {
  const ch = (channel || '').toLowerCase();
  const ref = (channelRef || '').toLowerCase();
  if (ch === 'expedia' || ref.startsWith('exp-')) return 'Expedia';
  if (ch === 'airbnb' || ref.startsWith('air-')) return 'Airbnb';
  if (ch === 'direct') return 'Direct Booking';
  if (ch === 'extranet') return 'Little Hotelier';
  if (ch === 'import') return 'Channel Manager Import';
  return 'Other';
}

// Split "First Last" → {firstName, lastName}; handles single-word names.
function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`=== beds24-load-bookings${isDryRun ? ' (DRY RUN)' : ''} — ${new Date().toISOString().slice(0, 10)} ===\n`);

// Load idempotency log
const log = loadLog();
const alreadyLoaded = new Set(Object.keys(log).map(Number));
if (alreadyLoaded.size > 0) {
  console.log(`Already loaded (skipping): ${alreadyLoaded.size} hub booking IDs\n`);
}

// Non-BDC confirmed future bookings with Beds24 room mapping
const bookings = (await db.execute(`
  SELECT b.id, b.propertyId, b.roomTypeId, b.guestName, b.email, b.phone,
         b.checkIn, b.checkOut, b.adults, b.children, b.totalPrice,
         b.channel, b.channelRef, b.notes, b.status,
         CAST(rt.beds24RoomId AS INTEGER) AS beds24RoomId,
         CAST(p.beds24PropId AS INTEGER) AS beds24PropId
  FROM Booking b
  JOIN RoomType rt ON rt.id = b.roomTypeId
  JOIN Property p ON p.id = b.propertyId
  WHERE b.status = 'confirmed'
    AND b.checkOut > date('now')
    AND b.channel NOT IN ('booking.com', 'bdc')
    AND NOT (b.channel = 'unknown' AND b.channelRef LIKE 'BDC-%')
    AND rt.beds24RoomId IS NOT NULL
    AND p.beds24PropId IS NOT NULL
  ORDER BY b.checkIn
`)).rows;

console.log(`Bookings to load: ${bookings.length}`);
console.log(`Excluded: BDC channel, "unknown" channel with BDC- refs\n`);

let loaded = 0, skipped = 0, errors = 0;

for (const bk of bookings) {
  const hubId = Number(bk.id);

  if (alreadyLoaded.has(hubId)) {
    console.log(`  SKIP #${hubId} (already in log → beds24Id=${log[hubId]})`);
    skipped++;
    continue;
  }

  const { firstName, lastName } = splitName(String(bk.guestName));
  const referer = mapChannel(String(bk.channel), String(bk.channelRef ?? ''));
  const notes = [
    `Hub booking #${hubId}`,
    bk.channelRef ? `Ref: ${bk.channelRef}` : null,
    bk.notes ? String(bk.notes).slice(0, 120) : null,
  ].filter(Boolean).join(' | ');

  const payload = [{
    propertyId: Number(bk.beds24PropId),
    roomId: Number(bk.beds24RoomId),
    arrival: String(bk.checkIn),
    departure: String(bk.checkOut),
    firstName,
    lastName,
    email: bk.email ? String(bk.email) : '',
    phone: bk.phone ? String(bk.phone) : '',
    numAdult: Number(bk.adults) || 1,
    numChild: Number(bk.children) || 0,
    price: bk.totalPrice != null ? Number(bk.totalPrice) : 0,
    status: 'confirmed',
    referer,
    notes,
  }];

  console.log(`  #${hubId} ${bk.channel} ${bk.propertyId} rt=${bk.roomTypeId} ${bk.checkIn}..${bk.checkOut} "${bk.guestName}" → ${referer}`);

  if (isDryRun) {
    console.log(`    [DRY] payload: ${JSON.stringify(payload[0]).slice(0, 200)}`);
    loaded++;
    continue;
  }

  try {
    const result = await b24Post('/bookings', payload);
    const entry = result[0];
    if (entry?.new?.id) {
      const beds24Id = entry.new.id;
      log[hubId] = beds24Id;
      saveLog(log);
      console.log(`    → beds24Id=${beds24Id}${entry.success ? '' : ' (warnings: ' + JSON.stringify(entry.warnings) + ')'}`);
      loaded++;
    } else {
      console.error(`    ERROR: unexpected response: ${JSON.stringify(result).slice(0, 200)}`);
      errors++;
    }
  } catch (err) {
    console.error(`    ERROR #${hubId}: ${err.message}`);
    errors++;
  }

  // Small delay between bookings to respect the rate limit
  await new Promise(r => setTimeout(r, 800));
}

console.log(`\nDone: ${loaded} loaded${isDryRun ? ' (dry-run)' : ''}, ${skipped} skipped (already done), ${errors} errors.`);
if (!isDryRun) {
  if (errors > 0) {
    console.log(`⚠  ${errors} errors — re-run to retry failed bookings (already-loaded will be skipped).`);
  } else {
    console.log('✓ All bookings posted. Log at automation/logs/beds24-booking-load.json');
  }
}
db.close();
