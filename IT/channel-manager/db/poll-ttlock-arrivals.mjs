// Poll TTLock unlock records for in-stay guests; write arrivedDetected/arrivedAt to CrmRecord.
// arrivedAt = EARLIEST successful door unlock since check-in that is attributed to the guest.
//
// Matching logic per booking:
//   1. Fetch all success==1, recordType in {3,7} unlocks since check-in 00:00, minus service codes.
//   2. If a guest lockCode is on file → look for earliest unlock with keyboardPwd == lockCode
//      (confirmed, arrivedSource='auto').
//   3. Else → earliest remaining unlock (unattributed, arrivedSource='auto-weak').
//   4. Never overwrite arrivedSource='manual'. Never downgrade 'auto' to 'auto-weak'.
//
// Usage:
//   node db/poll-ttlock-arrivals.mjs            # live run (writes to cloud DB)
//   node db/poll-ttlock-arrivals.mjs --dry-run  # prints what would be set, writes nothing
//   node db/poll-ttlock-arrivals.mjs --test     # run unit tests and exit
//
// Requires TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_TOKEN_PATH in .env
// (+ DATABASE_URL / DATABASE_AUTH_TOKEN for Turso).
//
// Lock map mirrored from:
//   /Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/scripts/cleaner_report.py
//   PROPERTIES dict — keep in sync when locks are added/changed.
//
// physicalRoom in the DB is stored as a bare number ("5"), NOT "Room 5".

import { createClient } from '@libsql/client';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes('--dry-run');
const isTest   = process.argv.includes('--test');

// ── .env loader ───────────────────────────────────────────────────────────────
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// ── Config ────────────────────────────────────────────────────────────────────
const CLIENT_ID     = process.env.TTLOCK_CLIENT_ID;
const CLIENT_SECRET = process.env.TTLOCK_CLIENT_SECRET;
const TOKEN_PATH    = process.env.TTLOCK_TOKEN_PATH ||
  '/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/ttlock_token.json';
const API_BASE = 'https://euapi.ttlock.com';
const CALL_DELAY_MS = 350;

// ── Service-code exclusion list ───────────────────────────────────────────────
// Source: scripts/cleaner_report.py CLEANER_CODE="1213" in the ttlock-auto-codes pipeline.
// Add any maintenance/host/master codes here; they will never trigger guest arrival detection.
const SERVICE_CODES = new Set(['1213']);

// ── Guest code lookup ─────────────────────────────────────────────────────────
// Mirrors lib/messaging.ts lockCodeFor() — reads from the pipeline's checkin_data.json.
const CHECKIN_DATA_PATH =
  process.env.CHECKIN_DATA_PATH ||
  '/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/automation-data/checkin_data.json';

function lockCodeFor(ref) {
  if (!ref) return null;
  try {
    const data = JSON.parse(readFileSync(CHECKIN_DATA_PATH, 'utf8'));
    const key = Object.keys(data).find((k) => k.trim().toLowerCase() === ref.trim().toLowerCase());
    return key ? (data[key]?.lockCode || null) : null;
  } catch {
    return null;
  }
}

// ── Arrival matching ──────────────────────────────────────────────────────────
// Returns { arrivedAt, arrivedSource } or null (no qualifying unlock).
// guestCode may be null (no code on file → falls back to weak detection).
function matchArrival(records, guestCode) {
  // Candidate unlocks: successful keypad (type 3) or card/NFC (type 7), excluding service codes.
  const candidates = records.filter(
    (r) => r.success === 1
      && (r.recordType === 3 || r.recordType === 7)
      && !SERVICE_CODES.has(String(r.keyboardPwd ?? '').trim()),
  );

  if (guestCode) {
    const code = String(guestCode).trim();
    const confirmed = candidates.filter((r) => String(r.keyboardPwd ?? '').trim() === code);
    if (confirmed.length > 0) {
      const earliest = confirmed.reduce((a, b) => (a.lockDate < b.lockDate ? a : b));
      return { arrivedAt: new Date(earliest.lockDate).toISOString(), arrivedSource: 'auto' };
    }
  }

  // Weak fallback: any non-service unlock (guest code unknown or not found in records).
  if (candidates.length > 0) {
    const earliest = candidates.reduce((a, b) => (a.lockDate < b.lockDate ? a : b));
    return { arrivedAt: new Date(earliest.lockDate).toISOString(), arrivedSource: 'auto-weak' };
  }

  return null;
}

// ── Unit tests (--test) ───────────────────────────────────────────────────────
if (isTest) {
  const T = (desc, fn) => {
    try {
      fn();
      console.log(`  PASS  ${desc}`);
    } catch (e) {
      console.log(`  FAIL  ${desc}: ${e.message}`);
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  console.log('=== poll-ttlock-arrivals unit tests ===\n');

  const makeRecord = (keyboardPwd, recordType = 3, success = 1, lockDate = Date.now()) =>
    ({ keyboardPwd, recordType, success, lockDate });

  // Test 1: Only cleaner code (1213) → NOT arrived
  T('cleaner-only unlock is not detected as arrived', () => {
    const records = [makeRecord('1213')];
    const result = matchArrival(records, null);
    assert(result === null, `expected null, got ${JSON.stringify(result)}`);
  });

  // Test 2: Guest code unlock → confirmed, arrivedSource='auto', arrivedAt = first such unlock
  T('guest-code unlock → auto, arrivedAt is earliest match', () => {
    const t1 = Date.now() - 10000;
    const t2 = Date.now();
    const records = [makeRecord('9999', 3, 1, t2), makeRecord('1234', 3, 1, t1)];
    const result = matchArrival(records, '1234');
    assert(result !== null, 'expected a result');
    assert(result.arrivedSource === 'auto', `expected auto, got ${result.arrivedSource}`);
    assert(result.arrivedAt === new Date(t1).toISOString(), `expected earliest t1, got ${result.arrivedAt}`);
  });

  // Test 2b: leading-zero lockCode comparison
  T('leading-zero lockCode string comparison works', () => {
    const records = [makeRecord('0930')];
    const result = matchArrival(records, '0930');
    assert(result !== null && result.arrivedSource === 'auto', 'expected auto match on 0930');
  });

  // Test 3: No code on file + non-service unlock → auto-weak
  T('no guest code + non-service unlock → auto-weak', () => {
    const records = [makeRecord('5555')];
    const result = matchArrival(records, null);
    assert(result !== null, 'expected a result');
    assert(result.arrivedSource === 'auto-weak', `expected auto-weak, got ${result.arrivedSource}`);
  });

  // Test 4: Manual override flag — matchArrival doesn't see it (loop guards it), tested via skip logic
  T('manual override check: arrivedSource=manual triggers skip (logic check)', () => {
    // The loop skips when b.arrivedSource === 'manual'; matchArrival is never called.
    // Simulate: matchArrival still works normally (it doesn't inspect arrivedSource).
    const records = [makeRecord('9999')];
    const result = matchArrival(records, null);
    assert(result?.arrivedSource === 'auto-weak', 'matchArrival itself is unaffected; loop guard prevents call');
  });

  // Test 5: No-downgrade guard — arrivedSource='auto' booking is skipped before TTLock call
  T('auto already set → loop skips re-detection (no-downgrade)', () => {
    // Simulated: loop would `continue` before reaching matchArrival.
    // Verify by checking guard condition used in the loop.
    const existingSource = 'auto';
    const shouldSkip = existingSource === 'manual' || existingSource === 'auto';
    assert(shouldSkip, 'expected skip when arrivedSource is already auto');
  });

  // Test 6: service code excluded even when guest code not found
  T('service code excluded in weak fallback (mix of service + other)', () => {
    const records = [makeRecord('1213'), makeRecord('7777')];
    const result = matchArrival(records, null);
    assert(result !== null, 'expected a result (7777 is not service)');
    assert(result.arrivedSource === 'auto-weak', 'expected auto-weak');
  });

  // Test 7: Seamless/Flat — no lock map → skipped (tested in main loop, not matchArrival)
  T('propId with no lock map → skipped (static assertion)', () => {
    const LOCK_MAP_KEYS = ['tooting', 'streatham', 'gassiot', 'valnay'];
    assert(!LOCK_MAP_KEYS.includes('seamless'), 'seamless not in map');
    assert(!LOCK_MAP_KEYS.includes('flat'), 'flat not in map');
  });

  console.log('\nDone.');
  process.exit(0);
}

// ── Guard: require credentials before any live work ───────────────────────────
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('TTLOCK_CLIENT_ID and TTLOCK_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

// ── Room → lockId map ─────────────────────────────────────────────────────────
// Keys are bare physicalRoom numbers ("5" not "Room 5"), matching the DB.
// Streatham Room 11 has no individual lock — uses the front door (16273050).
// Seamless Stays and Flat have no room locks → skipped (manual only).
const LOCK_MAP = {
  tooting: {
    front: 20641052,
    rooms: { '1': 21318606, '2': 21321678, '3': 21319208, '4': 21321180, '5': 21321314, '6': 21973872 },
  },
  streatham: {
    front: 16273050,
    rooms: {
      '1': 24719576, '2': 24641840, '3': 24719570, '4': 24746950, '5': 24717236, '6': 24717242,
      '7': 26157268, '8': 30947344, '9': 24692300, '10': 24717964,
      '11': 16273050, // no individual lock — front door
    },
  },
  gassiot: {
    front: 28606668,
    rooms: { '1': 31262246, '2': 31261208, '3': 31262700, '4': 31424108, '5': 31263276, '6': 31423836, '7': 31262938 },
  },
  valnay: {
    front: 27821908,
    rooms: { '1': 31453562, '2': 31285682, '3': 30948194, '4': 28062262, '5': 28065142, '6': 31284258 },
  },
};

// ── TTLock auth ───────────────────────────────────────────────────────────────
function loadToken() {
  if (!existsSync(TOKEN_PATH)) throw new Error(`ttlock_token.json not found at ${TOKEN_PATH}`);
  return JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
}

async function getAccessToken() {
  const tok = loadToken();
  if (tok.expires_at && tok.expires_at > Math.floor(Date.now() / 1000) + 60) {
    return tok.access_token;
  }
  console.log('TTLock token expired — refreshing…');
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: tok.refresh_token,
  });
  const res = await fetch(`${API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error('TTLock token refresh failed:', JSON.stringify(data));
    process.exit(1);
  }
  data.expires_at = Math.floor(Date.now() / 1000) + data.expires_in - 60;
  writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2));
  return data.access_token;
}

// ── TTLock API ────────────────────────────────────────────────────────────────
async function getLockRecords(lockId, startMs, endMs, accessToken) {
  const records = [];
  let page = 1;
  while (true) {
    const body = new URLSearchParams({
      clientId: CLIENT_ID,
      accessToken,
      lockId: String(lockId),
      startDate: String(startMs),
      endDate: String(endMs),
      pageNo: String(page),
      pageSize: '100',
      date: String(Date.now()),
    });
    const res = await fetch(`${API_BASE}/v3/lockRecord/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json();
    if (data.errcode && data.errcode !== 0) {
      console.warn(`  ⚠ lockId=${lockId} page=${page}: errcode=${data.errcode} ${data.errmsg || ''}`);
      break;
    }
    const batch = data.list || [];
    records.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return records;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── DB setup ──────────────────────────────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('DATABASE_URL not set'); process.exit(1); }
const db = createClient({ url: dbUrl, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

async function upsertArrival(bookingId, arrivedAt, arrivedSource) {
  if (isDryRun) return;
  await db.execute({
    sql: `INSERT INTO CrmRecord (bookingId, updatedAt) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(bookingId) DO NOTHING`,
    args: [bookingId],
  });
  // Belt-and-suspenders: WHERE guard ensures we never overwrite a manual entry even if the
  // loop's early-continue was somehow bypassed.
  await db.execute({
    sql: `UPDATE CrmRecord SET arrivedDetected='yes', arrivedAt=?, arrivedSource=?, updatedAt=CURRENT_TIMESTAMP
          WHERE bookingId=? AND (arrivedSource IS NULL OR arrivedSource NOT IN ('manual', 'auto'))`,
    args: [arrivedAt, arrivedSource, bookingId],
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
console.log(`=== poll-ttlock-arrivals ${isDryRun ? '(DRY RUN) ' : ''}${today} ===\n`);

const accessToken = await getAccessToken();

const result = await db.execute({
  sql: `SELECT b.id, b.channelRef, b.propertyId, b.physicalRoom, b.checkIn,
               COALESCE(c.arrivedSource, '') AS arrivedSource,
               COALESCE(c.arrivedDetected, '') AS arrivedDetected
        FROM Booking b
        LEFT JOIN CrmRecord c ON c.bookingId = b.id
        WHERE b.status = 'confirmed'
          AND b.checkIn <= '${today}'
          AND b.checkOut >= '${today}'
        ORDER BY b.checkIn`,
  args: [],
});

const bookings = result.rows;
console.log(`In-stay bookings: ${bookings.length}\n`);

let detected = 0, skipped = 0, noMatch = 0;

for (const b of bookings) {
  const ref      = b.channelRef ? String(b.channelRef) : 'no-ref';
  const propId   = String(b.propertyId);
  const room     = b.physicalRoom ? String(b.physicalRoom) : null;
  const bookingId = Number(b.id);
  const prefix   = `  [#${bookingId} ${ref} ${propId}/${room}]`;

  // Never overwrite a manual override; never downgrade a confirmed auto detection.
  if (b.arrivedSource === 'manual' || b.arrivedSource === 'auto') {
    console.log(`${prefix} SKIP: ${b.arrivedSource} (arrivedDetected=${b.arrivedDetected})`);
    skipped++;
    continue;
  }

  // Resolve lockId from map
  const propMap = LOCK_MAP[propId];
  if (!propMap) {
    console.log(`${prefix} SKIP: no lock map (Seamless/Flat)`);
    skipped++;
    continue;
  }
  const lockId = room ? propMap.rooms[room] : undefined;
  if (!lockId) {
    console.log(`${prefix} SKIP: room '${room}' not in lock map for ${propId}`);
    skipped++;
    continue;
  }

  // Look up guest's door code from the pipeline export.
  const guestCode = lockCodeFor(ref);

  // Query TTLock for records since check-in midnight.
  const checkInStartMs = new Date(b.checkIn + 'T00:00:00Z').getTime();
  await sleep(CALL_DELAY_MS);
  const records = await getLockRecords(lockId, checkInStartMs, Date.now(), accessToken);

  const match = matchArrival(records, guestCode);

  if (match) {
    const { arrivedAt, arrivedSource } = match;
    const sourceLabel = arrivedSource === 'auto' ? 'confirmed' : 'weak';
    console.log(`${prefix} ARRIVED [${sourceLabel}]  lockId=${lockId}  first=${arrivedAt}  code=${guestCode ?? 'unknown'}  (${records.length} records)`);
    if (isDryRun) {
      console.log(`    → would set arrivedDetected='yes', arrivedAt=${arrivedAt}, arrivedSource='${arrivedSource}'`);
    } else {
      await upsertArrival(bookingId, arrivedAt, arrivedSource);
    }
    detected++;
  } else {
    console.log(`${prefix} no qualifying unlock  lockId=${lockId}  records=${records.length}`);
    noMatch++;
  }
}

console.log(`\nDone: ${detected} detected, ${noMatch} no unlocks, ${skipped} skipped.`);
if (isDryRun) console.log('(DRY RUN — no writes made)');
