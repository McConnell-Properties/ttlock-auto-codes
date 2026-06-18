// One-time migration: push .data/checkin-contacts.json and .data/extras-requests.json
// to Turso via the CM's /api/checkin/upsert endpoint.
//
// Run once on the Mac before pm2 restart:
//   node scripts/migrate-local-data.mjs
//
// Safe to run multiple times — upsert is idempotent.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dir, '..', '.data');

// Load .env manually (same pattern as CM migration scripts).
const envPath = join(__dir, '..', '.env');
let CM_URL = '';
let CM_KEY = '';
try {
  const envLines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of envLines) {
    const stripped = line.replace(/#.*$/, '').trim();
    const m = stripped.match(/^([A-Z_]+)=(.+)$/);
    if (!m) continue;
    if (m[1] === 'CHANNEL_MANAGER_URL') CM_URL = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (m[1] === 'CM_API_KEY')          CM_KEY = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
} catch { /* .env not present */ }

if (!CM_URL || !CM_KEY) {
  console.error('CHANNEL_MANAGER_URL and CM_API_KEY must be set in .env');
  process.exit(1);
}

async function upsert(payload) {
  const res = await fetch(`${CM_URL}/api/checkin/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CM_KEY}` },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body}`);
  return JSON.parse(body);
}

// --- migrate checkin-contacts.json ---
let contacts = {};
try {
  contacts = JSON.parse(readFileSync(join(dataDir, 'checkin-contacts.json'), 'utf8'));
} catch { console.log('No checkin-contacts.json — skipping.'); }

let contactOk = 0, contactFail = 0;
for (const [ref, c] of Object.entries(contacts)) {
  const methods = c.contactMethods || (c.contactMethod
    ? [{ method: c.contactMethod, value: c.contactValue ?? '' }]
    : []);
  try {
    await upsert({
      ref,
      contact: {
        contactMethods: methods,
        earlyCheckin: c.earlyCheckin ?? null,
        parking: c.parking ?? false,
        luggage: c.luggage ?? null,
        cardSaved: c.cardSaved ?? false,
        savedAt: c.savedAt,
        arrivalTime: c.arrivalTime ?? null,
      },
      confirmedAt: c.savedAt,
      updatedAt: c.savedAt,
    });
    console.log(`  ✓ contact ${ref}`);
    contactOk++;
  } catch (e) {
    console.error(`  ✗ contact ${ref}: ${e.message}`);
    contactFail++;
  }
}
console.log(`\nContacts: ${contactOk} ok, ${contactFail} failed\n`);

// --- migrate extras-requests.json ---
let extrasRaw = [];
try {
  extrasRaw = JSON.parse(readFileSync(join(dataDir, 'extras-requests.json'), 'utf8'));
} catch { console.log('No extras-requests.json — skipping.'); }

// Group by ref so we do one upsert per booking.
const byRef = {};
for (const e of extrasRaw) {
  if (!byRef[e.ref]) byRef[e.ref] = [];
  byRef[e.ref].push({
    extraId: e.extraId,
    extraName: e.extraName,
    date: e.date ?? null,
    time: e.time ?? null,
    nights: e.nights ?? null,
    price: e.price ?? 0,
    status: e.status ?? 'requested',
    stripeSession: e.stripeSession ?? null,
  });
}

let extrasOk = 0, extrasFail = 0;
for (const [ref, extras] of Object.entries(byRef)) {
  try {
    await upsert({ ref, extras, updatedAt: new Date().toISOString() });
    console.log(`  ✓ extras  ${ref} (${extras.length} item(s))`);
    extrasOk++;
  } catch (e) {
    console.error(`  ✗ extras  ${ref}: ${e.message}`);
    extrasFail++;
  }
}
console.log(`\nExtras: ${extrasOk} ok, ${extrasFail} failed`);
console.log('\nMigration complete.');
