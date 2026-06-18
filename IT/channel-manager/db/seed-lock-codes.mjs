// One-time: populate Booking.lockCode from checkin_data.json.
// Keyed by channelRef; only updates rows where lockCode IS NULL.
//
// Usage:
//   node db/seed-lock-codes.mjs            # Turso cloud
//   node db/seed-lock-codes.mjs --local    # dev.db
//   node db/seed-lock-codes.mjs --dry-run  # print what it would set, no writes
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const useLocal = process.argv.includes('--local');
const dryRun = process.argv.includes('--dry-run');

const CHECKIN_DATA =
  process.env.CHECKIN_DATA_PATH ||
  '/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/automation-data/checkin_data.json';

const url = useLocal ? `file:${join(here, 'dev.db')}` : process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
const db = createClient({ url, authToken: useLocal ? undefined : process.env.DATABASE_AUTH_TOKEN });

async function seed() {
  console.log(`\nseed-lock-codes → ${useLocal ? 'local dev.db' : url}${dryRun ? ' (DRY RUN)' : ''}\n`);

  let checkinData;
  try {
    checkinData = JSON.parse(fs.readFileSync(CHECKIN_DATA, 'utf8'));
  } catch (e) {
    console.error(`Failed to read ${CHECKIN_DATA}: ${e.message}`);
    process.exit(1);
  }

  const refs = Object.keys(checkinData);
  console.log(`checkin_data.json entries: ${refs.length}`);

  let updated = 0, skipped = 0, notFound = 0;

  for (const ref of refs) {
    const entry = checkinData[ref];
    const lockCode = entry?.lockCode;
    if (!lockCode) { skipped++; continue; }

    const existing = await db.execute({
      sql: `SELECT id, lockCode FROM Booking WHERE channelRef = ? COLLATE NOCASE LIMIT 1`,
      args: [ref],
    });

    if (!existing.rows.length) { notFound++; continue; }

    const row = existing.rows[0];
    if (row.lockCode) { skipped++; continue; }

    if (dryRun) {
      console.log(`  WOULD SET: id=${row.id} ref=${ref} lockCode=${lockCode}`);
    } else {
      await db.execute({
        sql: `UPDATE Booking SET lockCode = ? WHERE id = ?`,
        args: [lockCode, Number(row.id)],
      });
    }
    updated++;
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped (no code or already set), ${notFound} refs not in DB`);
  if (dryRun) console.log('(DRY RUN — no writes made)');
}

seed().catch((e) => { console.error(e); process.exit(1); });
