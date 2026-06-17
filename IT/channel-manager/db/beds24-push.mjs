// Outbound drainer — consume pending BDC SyncJob rows → POST /inventory/rooms/calendar
//
// Booking.com rows ONLY. Expedia rows are untouched.
//
// DPR guard: Beds24 silently drops numAvail when a room has no Daily Price Rule.
// The POST still returns 201/success:true. The ONLY reliable signal is whether
// numAvail / price1 appears in the `modified` field of the per-room response.
// Jobs are marked done ONLY if the expected field appears in modified.calendar;
// otherwise they're marked failed with note "numAvail dropped — missing DPR?" so
// the missing-DPR rooms surface in the queue and don't silently stall.
//
// Usage:
//   node db/beds24-push.mjs                        # dry-run (default)
//   BEDS24_PUSH_DRYRUN=0 node db/beds24-push.mjs   # live
import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// ── .env loader ──────────────────────────────────────────────────────────────
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// ── Refuse to run without DATABASE_URL ───────────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set. Refusing to fall back to dev.db.');
  process.exit(1);
}

const isDryRun = process.env.BEDS24_PUSH_DRYRUN !== '0';

// ── DB ────────────────────────────────────────────────────────────────────────
const db = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

// ── Beds24 token manager ──────────────────────────────────────────────────────
const BASE_URL = 'https://api.beds24.com/v2';
const REFRESH_GRACE_MS = 5 * 60 * 1000;

let memToken = null;
let memExpiresAt = 0;

async function loadCachedToken() {
  const row = await db.execute({ sql: 'SELECT value FROM Setting WHERE key = ?', args: ['beds24_token'] });
  if (!row.rows[0]) return null;
  try { return JSON.parse(row.rows[0].value); } catch { return null; }
}

async function persistToken(token, expiresAt) {
  await db.execute({
    sql: `INSERT INTO Setting (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: ['beds24_token', JSON.stringify({ token, expiresAt })],
  });
}

async function doRefreshToken() {
  const refreshTok = process.env.BEDS24_REFRESH_TOKEN;
  if (!refreshTok) throw new Error('BEDS24_REFRESH_TOKEN not set');
  const res = await fetch(`${BASE_URL}/authentication/token`, { headers: { refreshToken: refreshTok } });
  if (!res.ok) throw new Error(`Beds24 token refresh failed: HTTP ${res.status}`);
  const data = await res.json();
  const expiresAt = Date.now() + data.expiresIn * 1000;
  memToken = data.token;
  memExpiresAt = expiresAt;
  await persistToken(data.token, expiresAt);
  return data.token;
}

async function getToken() {
  const now = Date.now();
  if (memToken && memExpiresAt - now > REFRESH_GRACE_MS) return memToken;
  const cached = await loadCachedToken();
  if (cached && cached.expiresAt - now > REFRESH_GRACE_MS) {
    memToken = cached.token;
    memExpiresAt = cached.expiresAt;
    return cached.token;
  }
  return doRefreshToken();
}

async function beds24Call(method, path, opts = {}, isRetry = false) {
  const token = await getToken();
  const qs = opts.query
    ? '?' + Object.entries(opts.query).filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  const url = `${BASE_URL}${path}${qs}`;

  const res = await fetch(url, {
    method,
    headers: { token, 'Content-Type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const remaining = res.headers.get('x-five-min-limit-remaining');
  const cost = res.headers.get('x-request-cost');
  if (remaining !== null || cost !== null) {
    const low = remaining !== null && Number(remaining) < 20;
    const tag = low ? '[BEDS24 RATE LOW]' : '[beds24]';
    console.log(`  ${tag} ${method} ${path} cost=${cost ?? '?'} remaining=${remaining ?? '?'}`);
    if (low && method === 'GET') {
      console.log('  Rate limit low — sleeping 90s before continuing...');
      await new Promise(r => setTimeout(r, 90_000));
    }
  }

  if (res.status === 401 && !isRetry) {
    memToken = null; memExpiresAt = 0;
    await doRefreshToken();
    return beds24Call(method, path, opts, true);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Beds24 ${method} ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// ── buildCalendarPayload ──────────────────────────────────────────────────────
function buildCalendarPayload(entries) {
  const byRoom = new Map();
  for (const e of entries) {
    let item = byRoom.get(e.roomId);
    if (!item) { item = { roomId: e.roomId, calendar: [] }; byRoom.set(e.roomId, item); }
    const cal = { from: e.from, to: e.to };
    if (e.price !== undefined && e.price !== null) cal.price1 = e.price;
    if (e.numAvail !== undefined && e.numAvail !== null) cal.numAvail = e.numAvail;
    if (e.minStay !== undefined && e.minStay !== null) cal.minStay = e.minStay;
    item.calendar.push(cal);
  }
  return Array.from(byRoom.values());
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function nextDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function profileKey(e) {
  return `${e.price ?? ''}|${e.numAvail ?? ''}|${e.minStay ?? ''}`;
}

async function markJobs(ids, status, note) {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await db.execute({
      sql: `UPDATE SyncJob SET status=?, doneAt=CURRENT_TIMESTAMP, note=? WHERE id IN (${chunk.map(() => '?').join(',')})`,
      args: [status, note ?? null, ...chunk],
    });
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`=== beds24-push ${new Date().toISOString().slice(0, 16)} [${isDryRun ? 'DRY RUN' : 'LIVE'}] ===`);

// Pending BDC rows with a Beds24 room mapping.
// inventory value column is stale (totalUnits − bookings − blocks); we recompute
// numAvail = totalUnits − blocks at push time (Model A: Beds24 subtracts its own
// bookings, so we must not subtract them or we double-count).
const rs = await db.execute(`
  SELECT j.id, j.roomTypeId, j.date, j.field, j.value,
         rt.beds24RoomId, rt.name AS roomName, rt.totalUnits,
         p.name AS propertyName
  FROM   SyncJob j
  JOIN   RoomType rt ON rt.id = j.roomTypeId
  JOIN   Property p  ON p.id  = rt.propertyId
  WHERE  j.channel = 'booking.com'
    AND  j.status  = 'pending'
    AND  rt.beds24RoomId IS NOT NULL
    AND  rt.propertyId  != 'seamless'
  ORDER  BY j.roomTypeId, j.date, j.field, j.id
`);

const allRows = rs.rows;
console.log(`Pending BDC SyncJob rows (beds24RoomId mapped): ${allRows.length}`);

if (allRows.length === 0) {
  console.log('Nothing to push.');
  db.close();
  process.exit(0);
}

// ── Dedup: keep latest id per (roomTypeId, date, field) ──────────────────────
const latestByKey = new Map();
for (const row of allRows) {
  const key = `${row.roomTypeId}|${row.date}|${row.field}`;
  const existing = latestByKey.get(key);
  if (!existing || Number(row.id) > Number(existing.id)) latestByKey.set(key, row);
}
const deduped = Array.from(latestByKey.values());
const dropped = allRows.length - deduped.length;
if (dropped > 0) console.log(`  Collapsed ${dropped} duplicate rows (kept latest per room+date+field).`);

// ── Pre-fetch blocks for inventory rows (recompute numAvail = cap − blocks) ──
const invRoomTypeIds = [...new Set(
  deduped.filter(r => r.field === 'inventory').map(r => Number(r.roomTypeId))
)];
const blockByKey = new Map();
if (invRoomTypeIds.length > 0) {
  const ph = invRoomTypeIds.map(() => '?').join(',');
  const blockRows = (await db.execute({
    sql: `SELECT roomTypeId, date, SUM(units) AS units FROM Block
          WHERE roomTypeId IN (${ph}) GROUP BY roomTypeId, date`,
    args: invRoomTypeIds,
  })).rows;
  for (const b of blockRows) blockByKey.set(`${b.roomTypeId}|${b.date}`, Number(b.units));
}

// ── Build per-room date profile map ──────────────────────────────────────────
const roomDateMap = new Map();
for (const row of deduped) {
  const roomId = Number(row.beds24RoomId);
  if (!roomDateMap.has(roomId)) roomDateMap.set(roomId, new Map());
  const dateMap = roomDateMap.get(roomId);
  if (!dateMap.has(row.date)) {
    dateMap.set(row.date, { ids: [], roomName: row.roomName, propertyName: row.propertyName });
  }
  const entry = dateMap.get(row.date);
  entry.ids.push(Number(row.id));
  const val = Number(row.value);
  if (row.field === 'price')     entry.price    = val;
  if (row.field === 'minstay')   entry.minStay  = val;
  if (row.field === 'inventory') {
    const blocked = blockByKey.get(`${row.roomTypeId}|${row.date}`) ?? 0;
    entry.numAvail = Math.max(0, Number(row.totalUnits) - blocked);
  }
}

// ── Per-room job ID tracking and field flags (for DPR guard) ─────────────────
const roomIdToJobIds = new Map();
const roomIdHasInv = new Map();
const roomIdHasPrice = new Map();
for (const [roomId, dateMap] of roomDateMap) {
  const ids = [];
  let hasInv = false, hasPrice = false;
  for (const entry of dateMap.values()) {
    ids.push(...entry.ids);
    if (entry.numAvail !== undefined) hasInv = true;
    if (entry.price !== undefined) hasPrice = true;
  }
  roomIdToJobIds.set(roomId, ids);
  roomIdHasInv.set(roomId, hasInv);
  roomIdHasPrice.set(roomId, hasPrice);
}

// ── Range-compress consecutive dates with identical profiles per room ─────────
const calendarEntries = [];
let totalRanges = 0;

for (const [roomId, dateMap] of roomDateMap) {
  const sortedDates = Array.from(dateMap.keys()).sort();
  const info = `${dateMap.get(sortedDates[0]).propertyName} / ${dateMap.get(sortedDates[0]).roomName} (beds24RoomId=${roomId})`;

  let rangeStart = sortedDates[0];
  let rangeProfile = { ...dateMap.get(rangeStart) };
  let roomRanges = 0;

  for (let i = 1; i <= sortedDates.length; i++) {
    const date = sortedDates[i];
    const prevDate = sortedDates[i - 1];
    const cur = date ? dateMap.get(date) : null;
    const sameProfile = cur && date === nextDate(prevDate) && profileKey(cur) === profileKey(rangeProfile);

    if (sameProfile) continue;

    calendarEntries.push({
      roomId, from: rangeStart, to: prevDate,
      price: rangeProfile.price, numAvail: rangeProfile.numAvail, minStay: rangeProfile.minStay,
    });
    roomRanges++;
    if (cur) { rangeStart = date; rangeProfile = { ...cur }; }
  }
  totalRanges += roomRanges;
  console.log(`  ${info}: ${sortedDates.length} dates → ${roomRanges} range(s)`);
}

console.log(`\nTotal: ${deduped.length} jobs → ${totalRanges} ranges across ${roomDateMap.size} room(s)`);

const payload = buildCalendarPayload(calendarEntries);

// ── Dry-run ───────────────────────────────────────────────────────────────────
if (isDryRun) {
  console.log('\n--- Payload that WOULD be POSTed to POST /inventory/rooms/calendar ---');
  console.log(JSON.stringify(payload, null, 2));

  const sampleRooms = payload.slice(0, 2);
  if (sampleRooms.length > 0) {
    console.log('\n--- Current Beds24 availability (sample, first 2 rooms) ---');
    for (const item of sampleRooms) {
      const dates = item.calendar.map(c => c.from).sort();
      try {
        const avail = await beds24Call('GET', '/inventory/rooms/availability', {
          query: { roomId: item.roomId, startDate: dates[0], endDate: dates[dates.length - 1] },
        });
        console.log(`  roomId=${item.roomId} [${dates[0]} → ${dates[dates.length - 1]}] current:`);
        console.log('  ' + JSON.stringify(avail).slice(0, 600));
      } catch (err) {
        console.log(`  roomId=${item.roomId}: GET failed — ${err.message}`);
      }
    }
  }

  console.log(`\n[DRY RUN] Would POST ${payload.length} room payloads covering ${totalRanges} ranges.`);
  console.log(`[DRY RUN] Would process ${deduped.length} SyncJob rows across ${roomDateMap.size} room(s).`);
  console.log('[DRY RUN] No writes made. Set BEDS24_PUSH_DRYRUN=0 to go live.');
  db.close();
  process.exit(0);
}

// ── Live ──────────────────────────────────────────────────────────────────────
console.log(`\nPOSTing ${payload.length} room payloads to Beds24...`);
const responses = await beds24Call('POST', '/inventory/rooms/calendar', { body: payload });
console.log('POST complete. Checking per-room modified fields (DPR guard)...\n');

let doneCount = 0, failedCount = 0;

for (let i = 0; i < payload.length; i++) {
  const roomId = payload[i].roomId;
  const resp = Array.isArray(responses) ? responses[i] : null;
  const jobIds = roomIdToJobIds.get(roomId) ?? [];
  if (!jobIds.length) continue;

  const hasInv   = roomIdHasInv.get(roomId) ?? false;
  const hasPrice = roomIdHasPrice.get(roomId) ?? false;

  // Verdict: does modified.calendar confirm each field we pushed?
  let numAvailOk = !hasInv;
  let price1Ok   = !hasPrice;
  const modCalendar = resp?.modified?.calendar ?? [];
  for (const cal of modCalendar) {
    if ('numAvail' in cal) numAvailOk = true;
    if ('price1'   in cal) price1Ok   = true;
  }

  if (resp?.errors?.length) {
    console.log(`  roomId=${roomId}: API errors — ${JSON.stringify(resp.errors)}`);
  }

  if (numAvailOk && price1Ok) {
    await markJobs(jobIds, 'done', null);
    console.log(`  roomId=${roomId}: ${jobIds.length} job(s) → done (modified confirmed)`);
    doneCount += jobIds.length;
  } else {
    const missing = [];
    if (!numAvailOk) missing.push('numAvail');
    if (!price1Ok)   missing.push('price1');
    const note = `${missing.join(',')} dropped — missing DPR?`;
    await markJobs(jobIds, 'failed', note);
    console.log(`  roomId=${roomId}: ${jobIds.length} job(s) → FAILED (${note})`);
    failedCount += jobIds.length;
  }
}

console.log(`\nDone: ${doneCount} job(s) marked done, ${failedCount} job(s) marked failed.`);
if (failedCount > 0) {
  console.log('FAILED jobs have note "numAvail dropped — missing DPR?" or "price1 dropped — missing DPR?"');
  console.log('Fix: add a Daily Price Rule in the Beds24 UI for each affected room, then re-queue.');
}
db.close();
