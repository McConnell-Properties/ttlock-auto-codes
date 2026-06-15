// Copy the database to db/backups/dev-YYYY-MM-DD-HHmm.db and prune to the
// newest 30. Run manually or on a schedule:  npm run db:backup
import { copyFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'dev.db');
if (!existsSync(src)) { console.error('db/dev.db not found'); process.exit(1); }

const dir = join(here, 'backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
const dest = join(dir, `dev-${stamp}.db`);
copyFileSync(src, dest);

const backups = readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
while (backups.length > 30) unlinkSync(join(dir, backups.shift()));

console.log(`Backed up to db/backups/dev-${stamp}.db (${backups.length} kept)`);
