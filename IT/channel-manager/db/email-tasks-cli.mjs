// Email-booking task CLI — for Claude (or you) to work off the detail-fetch
// queue created by poll-booking-emails.mjs.
//
//   node db/email-tasks-cli.mjs list            # pending tasks as JSON (with extranet links)
//   node db/email-tasks-cli.mjs done 3,4        # mark task ids done (booking entered in DB)
//   node db/email-tasks-cli.mjs dismiss 5 "dup" # dismiss with a note
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const [cmd, arg1, arg2] = process.argv.slice(2);

if (cmd === 'list') {
  const rs = await db.execute(
    `SELECT t.*, p.name AS propertyName FROM EmailBookingTask t
     LEFT JOIN Property p ON p.id = t.propertyId
     WHERE t.status = 'pending' ORDER BY t.createdAt`
  );
  console.log(JSON.stringify({ tasks: rs.rows.map((r) => ({ ...r })), summary: `${rs.rows.length} pending` }, null, 1));
} else if (cmd === 'done' || cmd === 'dismiss') {
  const ids = (arg1 || '').split(',').map((s) => Number(s.trim())).filter(Boolean);
  if (!ids.length) { console.error('usage: email-tasks-cli.mjs done|dismiss <id,id,...> ["note"]'); process.exit(1); }
  for (const id of ids) {
    await db.execute({
      sql: `UPDATE EmailBookingTask SET status = ?, doneAt = CURRENT_TIMESTAMP, note = COALESCE(?, note) WHERE id = ?`,
      args: [cmd === 'done' ? 'done' : 'dismissed', arg2 ?? null, id],
    });
  }
  console.log(`${ids.length} task(s) marked ${cmd === 'done' ? 'done' : 'dismissed'}`);
} else {
  console.error('usage: node db/email-tasks-cli.mjs list | done <ids> | dismiss <ids> ["note"]');
  process.exit(1);
}
db.close();
