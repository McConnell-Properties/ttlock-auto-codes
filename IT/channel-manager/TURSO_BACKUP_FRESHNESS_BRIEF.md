# Build brief — Real Turso backups + a "last write" freshness check

Two related fixes in `channel-manager`. **Both are READ-ONLY against the cloud DB** (dump + max-timestamp queries) — no writes to Turso, no schema changes.

**Problem:** since the cloud migration, `db/backup.mjs` still just copies the **local** `db/dev.db` — which is no longer the production data. So the production **Turso** DB has effectively no backups. The daily `db-backup` launchd job (04:00) is running but backing up the wrong thing.

> **Coordination:** a separate agent owns the OTA inventory syncing (`sync-inventory` job). Don't touch that or any other job — only `db/backup.mjs`, a new `db/last-write.mjs`, and (if needed) the `db-backup` line in `automation/install.sh`.

---

## 1. Fix `db/backup.mjs` to back up whatever `DATABASE_URL` points at
- **Self-load `.env`** (same loader used in `sync-cli.mjs`/`stripe-sync.mjs`) so it sees `DATABASE_URL` + `DATABASE_AUTH_TOKEN`.
- **If `DATABASE_URL` is a `libsql://…` (cloud) URL:** produce a real logical dump of the cloud DB using `@libsql/client` (already a dep) — no Turso CLI dependency (the launchd job runs headless, so don't rely on an interactive `turso auth` session):
  - Enumerate tables: `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`.
  - For each table, emit its `CREATE TABLE` DDL + `INSERT` statements for all rows (properly escaped/parameterised values).
  - Write to `db/backups/cloud-YYYY-MM-DD-HHmm.sql`. Wrap in `BEGIN TRANSACTION; … COMMIT;` so it restores cleanly.
- **If `DATABASE_URL` is a local `file:…`** (dev): keep the current behaviour (copy `dev.db`), naming it `dev-…`. So the job is correct in both environments.
- Keep the **prune-to-newest-30** logic (across both `.sql` and `.db` files).
- Print a one-line summary: mode (cloud/local), file written, total rows, tables count, backups kept.
- (Optional) If the `turso` CLI *is* available and authed, `turso db shell mcconnell-cm .dump` is an acceptable alternative — but the node path must work without it.

## 2. New `db/last-write.mjs` — freshness check
Answers "when was Turso last updated?" in one command. Self-load `.env`; read-only.
- Query max recency columns across the key tables, e.g.:
  - `CrmRecord` → `max(updatedAt)`
  - `ExtrasRequest` → `max(importedAt)`
  - `Booking` → `max(paidAt)` (and `max(createdAt)` if the column exists)
  - `SyncJob` → `max(doneAt)` (if present)
- Print a small table (table → latest timestamp) plus a single **"most recent write across all: <ts>"** line.
- Add an npm script `db:freshness` → `node db/last-write.mjs`. (Backup already has `db:backup`.)

## 3. Confirm the launchd job
`automation/install.sh` already wires `db-backup` (daily 04:00) → `node db/backup.mjs`. No change needed unless the script's invocation differs; verify it runs headless and writes a `cloud-*.sql` when `.env` has the libsql URL. Don't re-order or touch other jobs.

---

## Tests (report PASS/FAIL)
1. With the cloud `DATABASE_URL` set: `node db/backup.mjs` → writes `db/backups/cloud-<stamp>.sql`, prints mode=cloud + row/table counts; **no writes to Turso** (dump is select-only).
2. Restorability: the dump loads without error into a scratch sqlite (`sqlite3 :memory: < db/backups/cloud-<stamp>.sql`) and table row counts match the live counts.
3. Retention: after >30 backups exist, oldest are pruned to 30.
4. With `DATABASE_URL=file:./dev.db`: falls back to the local copy path, names it `dev-…`.
5. `node db/last-write.mjs` prints per-table max timestamps + the overall latest, read from the cloud.
6. The `db-backup` launchd run produces a `cloud-*.sql` headlessly (no interactive auth prompt).

No destructive operations anywhere; cloud access is strictly read-only.
