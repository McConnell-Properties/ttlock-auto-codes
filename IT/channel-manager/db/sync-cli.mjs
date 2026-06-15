// Sync queue CLI — for Claude (or you) to read and close sync jobs without the web UI.
//
//   node db/sync-cli.mjs list                               # counts of pending inventory + pricing jobs
//   node db/sync-cli.mjs list booking.com                   # same, filtered by channel
//   node db/sync-cli.mjs list booking.com --type inventory  # pending inventory jobs only (JSON array)
//   node db/sync-cli.mjs list booking.com --type pricing    # pending price ranges only (JSON array)
//   node db/sync-cli.mjs list booking.com --type all        # full combined output (can be large)
//   node db/sync-cli.mjs done 12,13,14                      # mark job ids done
//   node db/sync-cli.mjs failed 15 "reason"                 # mark failed with note
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

// Load .env so manual runs use Turso, not the local dev.db fallback
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

// Parse --type flag before positional args
const rawArgs = process.argv.slice(2);
const typeIdx = rawArgs.indexOf('--type');
const typeFilter = typeIdx !== -1 ? rawArgs[typeIdx + 1] : null;
const filteredArgs = typeIdx !== -1 ? [...rawArgs.slice(0, typeIdx), ...rawArgs.slice(typeIdx + 2)] : rawArgs;
const [cmd, arg1, arg2] = filteredArgs;

function nextDay(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

if (cmd === 'list') {
  const channelFilter = arg1 ? ` AND j.channel = '${arg1.replace(/'/g, '')}'` : '';
  const rs = await db.execute(
    `SELECT j.id, j.channel, j.date, j.field, j.value, rt.name AS roomType, rt.bdcRoomId, rt.expediaName,
            p.name AS property, p.bdcHotelId, p.expediaHotelId
     FROM SyncJob j JOIN RoomType rt ON rt.id = j.roomTypeId JOIN Property p ON p.id = rt.propertyId
     WHERE j.status = 'pending'${channelFilter}
     ORDER BY j.channel, p.name, rt.name, j.field, j.date`
  );
  const jobs = rs.rows.map((r) => ({ ...r }));
  const inventory = jobs.filter((j) => j.field === 'inventory');
  // group price jobs into contiguous same-price ranges
  const ranges = [];
  let cur = null;
  for (const j of jobs.filter((x) => x.field === 'price')) {
    if (cur && cur.channel === j.channel && cur.roomType === j.roomType && cur.property === j.property &&
        cur.price === Number(j.value) && j.date === nextDay(cur.to)) {
      cur.to = j.date;
      cur.ids.push(j.id);
    } else {
      cur = { channel: j.channel, property: j.property, bdcHotelId: j.bdcHotelId, roomType: j.roomType,
              bdcRoomId: j.bdcRoomId, expediaName: j.expediaName, from: j.date, to: j.date,
              price: Number(j.value), ids: [j.id] };
      ranges.push(cur);
    }
  }

  if (typeFilter === 'inventory') {
    console.log(JSON.stringify({ inventoryJobs: inventory }, null, 1));
  } else if (typeFilter === 'pricing') {
    console.log(JSON.stringify({ priceRanges: ranges }, null, 1));
  } else if (typeFilter === 'all') {
    console.log(JSON.stringify({ inventoryJobs: inventory, priceRanges: ranges,
      summary: `${inventory.length} inventory jobs, ${ranges.length} price ranges` }, null, 1));
  } else {
    // default: counts only — avoids accidentally pulling the full ~3 MB price blob
    console.log(JSON.stringify({
      inventoryJobs: inventory.length,
      priceRanges: ranges.length,
      hint: 'add --type inventory | --type pricing | --type all for full output',
    }));
  }
} else if (cmd === 'done' || cmd === 'failed') {
  // SyncJob IDs are globally unique (single autoincrement table) — no type namespacing needed
  const ids = arg1.split(',').map(Number).filter(Boolean);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await db.execute({
      sql: `UPDATE SyncJob SET status = '${cmd}', doneAt = CURRENT_TIMESTAMP${arg2 ? ', note = ?' : ''}
            WHERE id IN (${chunk.map(() => '?').join(',')})`,
      args: arg2 ? [arg2, ...chunk] : chunk,
    });
  }
  console.log(`${ids.length} jobs marked ${cmd}`);
} else {
  console.log('Usage: node db/sync-cli.mjs list [channel] [--type inventory|pricing|all] | done <ids> | failed <ids> [note]');
}
db.close();
