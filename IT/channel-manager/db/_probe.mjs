import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const here = '/sessions/confident-magical-hopper/mnt/ttlock-auto-codes/IT/channel-manager/db';
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url });
// total pending price jobs
let r = await db.execute("SELECT field, count(*) c FROM SyncJob WHERE status='pending' GROUP BY field");
console.log('pending by field:', r.rows);
// createdAt distribution (by minute)
r = await db.execute("SELECT substr(createdAt,1,16) m, count(*) c FROM SyncJob WHERE status='pending' GROUP BY m ORDER BY c DESC LIMIT 15");
console.log('createdAt buckets (top):', r.rows);
// overall min/max createdAt
r = await db.execute("SELECT min(createdAt) mn, max(createdAt) mx FROM SyncJob WHERE status='pending'");
console.log('created range:', r.rows);
// status overview whole table
r = await db.execute("SELECT status, count(*) c FROM SyncJob GROUP BY status");
console.log('all statuses:', r.rows);
db.close();
