// Drainer core — consume pending BDC SyncJob rows → Beds24 POST /inventory/rooms/calendar
//
// Imported by Vercel cron routes (app/api/cron/beds24-push/route.ts).
// The standalone CLI is db/beds24-push.mjs (self-contained for launchd use).
//
// DPR guard: mark jobs done ONLY if numAvail/price1 appears in the per-room
// modified object. A 201 with no `modified` means a no-op or silent drop.
//
// Concurrency safety: each runBeds24Push() call generates a unique claimId and
// atomically UPDATE-claims pending→processing rows before reading them. Two
// concurrent calls each see only their own claimed rows. A module-level flag
// short-circuits a second call within the same process. Stale processing rows
// (processingAt > 10 min ago) are reset to pending at the start of each run.
import { randomUUID } from 'crypto';
import { db } from './db';
import { beds24, buildCalendarPayload, type CalendarEntry } from './beds24';

interface SyncRow {
  id: number;
  roomTypeId: number;
  date: string;
  field: string;
  value: number;
  beds24RoomId: number;
  totalUnits: number;
  roomName: string;
  propertyName: string;
}

interface DateProfile {
  ids: number[];
  price?: number;
  numAvail?: number;
  minStay?: number;
  roomName: string;
  propertyName: string;
}

interface Beds24CalendarResponse {
  success: boolean;
  modified?: {
    roomId: number;
    calendar: Array<{ from: string; to: string; numAvail?: number; price1?: number }>;
  };
  errors?: Array<Record<string, unknown>>;
}

export interface PushResult {
  done: number;
  failed: number;
  dryRun: boolean;
  skipped?: boolean;
}

// In-process guard: prevents concurrent calls within the same server instance
// from stacking up. The 10-min launchd cron catches anything missed while
// the module-level flag is set.
let localDraining = false;

function nextDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function profileKey(e: DateProfile): string {
  return `${e.price ?? ''}|${e.numAvail ?? ''}|${e.minStay ?? ''}`;
}

async function markJobs(ids: number[], status: 'done' | 'failed', note: string | null) {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await db.execute({
      sql: `UPDATE SyncJob SET status=?, doneAt=CURRENT_TIMESTAMP, note=? WHERE id IN (${chunk.map(() => '?').join(',')})`,
      args: [status, note, ...chunk],
    });
  }
}

export async function runBeds24Push(opts: { dryRun?: boolean } = {}): Promise<PushResult> {
  const dryRun = opts.dryRun ?? true;

  if (localDraining) return { done: 0, failed: 0, dryRun, skipped: true };
  localDraining = true;

  try {
    // Reset stale processing rows from crashed drainer runs (> 10 min ago)
    await db.execute(
      `UPDATE SyncJob SET status='pending', processingAt=NULL, note=NULL
       WHERE status='processing' AND processingAt < datetime('now', '-10 minutes')`
    );

    // Atomic claim: stamp a unique token into note so concurrent callers each
    // see only their own batch. Turso serializes writes, so only one UPDATE
    // wins the race to write each row; the other writer's SELECT finds 0 rows.
    const claimId = randomUUID().slice(0, 8);
    await db.execute({
      sql: `UPDATE SyncJob SET status='processing', processingAt=CURRENT_TIMESTAMP, note=?
            WHERE status='pending' AND channel='booking.com'
              AND roomTypeId IN (
                SELECT rt.id FROM RoomType rt
                WHERE rt.beds24RoomId IS NOT NULL AND rt.propertyId != 'seamless'
              )`,
      args: [claimId],
    });

    // Read only the rows we claimed
    const rs = await db.execute({
      sql: `SELECT j.id, j.roomTypeId, j.date, j.field, j.value,
                   rt.beds24RoomId, rt.name AS roomName, rt.totalUnits,
                   p.name AS propertyName
            FROM   SyncJob j
            JOIN   RoomType rt ON rt.id = j.roomTypeId
            JOIN   Property p  ON p.id  = rt.propertyId
            WHERE  j.channel = 'booking.com'
              AND  j.status  = 'processing'
              AND  j.note    = ?`,
      args: [claimId],
    });

    if (rs.rows.length === 0) return { done: 0, failed: 0, dryRun };

    const allRows = rs.rows as unknown as SyncRow[];

    // Dedup: keep latest id per (roomTypeId, date, field)
    const latestByKey = new Map<string, SyncRow>();
    for (const row of allRows) {
      const key = `${row.roomTypeId}|${row.date}|${row.field}`;
      const existing = latestByKey.get(key);
      if (!existing || row.id > existing.id) latestByKey.set(key, row);
    }
    const deduped = Array.from(latestByKey.values());

    // Pre-fetch blocks for inventory rows
    const invRoomTypeIds = [...new Set(
      deduped.filter(r => r.field === 'inventory').map(r => r.roomTypeId)
    )];
    const blockByKey = new Map<string, number>();
    if (invRoomTypeIds.length > 0) {
      const ph = invRoomTypeIds.map(() => '?').join(',');
      const blockRows = (await db.execute({
        sql: `SELECT roomTypeId, date, SUM(units) AS units FROM Block
              WHERE roomTypeId IN (${ph}) GROUP BY roomTypeId, date`,
        args: invRoomTypeIds,
      })).rows as unknown as Array<{ roomTypeId: number; date: string; units: number }>;
      for (const b of blockRows) blockByKey.set(`${b.roomTypeId}|${b.date}`, Number(b.units));
    }

    // Build per-room date profile map
    const roomDateMap = new Map<number, Map<string, DateProfile>>();
    for (const row of deduped) {
      const roomId = row.beds24RoomId;
      if (!roomDateMap.has(roomId)) roomDateMap.set(roomId, new Map());
      const dateMap = roomDateMap.get(roomId)!;
      if (!dateMap.has(row.date)) {
        dateMap.set(row.date, { ids: [], roomName: row.roomName, propertyName: row.propertyName });
      }
      const entry = dateMap.get(row.date)!;
      entry.ids.push(row.id);
      if (row.field === 'price')     entry.price    = row.value;
      if (row.field === 'minstay')   entry.minStay  = row.value;
      if (row.field === 'inventory') {
        const blocked = blockByKey.get(`${row.roomTypeId}|${row.date}`) ?? 0;
        entry.numAvail = Math.max(0, row.totalUnits - blocked);
      }
    }

    // Per-room job ID tracking and field flags
    const roomIdToJobIds = new Map<number, number[]>();
    const roomIdHasInv   = new Map<number, boolean>();
    const roomIdHasPrice = new Map<number, boolean>();
    for (const [roomId, dateMap] of roomDateMap) {
      const ids: number[] = [];
      let hasInv = false, hasPrice = false;
      for (const entry of dateMap.values()) {
        ids.push(...entry.ids);
        if (entry.numAvail !== undefined) hasInv = true;
        if (entry.price !== undefined)    hasPrice = true;
      }
      roomIdToJobIds.set(roomId, ids);
      roomIdHasInv.set(roomId, hasInv);
      roomIdHasPrice.set(roomId, hasPrice);
    }

    // Range-compress consecutive dates with identical profiles
    const calendarEntries: CalendarEntry[] = [];
    for (const [roomId, dateMap] of roomDateMap) {
      const sortedDates = Array.from(dateMap.keys()).sort();
      let rangeStart = sortedDates[0];
      let rangeProfile = { ...dateMap.get(rangeStart)! };

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
        if (cur) { rangeStart = date; rangeProfile = { ...cur }; }
      }
    }

    const payload = buildCalendarPayload(calendarEntries);

    if (dryRun) {
      // Release the claim so the cron can pick up the rows normally
      await db.execute({
        sql: `UPDATE SyncJob SET status='pending', processingAt=NULL, note=NULL WHERE note=?`,
        args: [claimId],
      });
      return { done: 0, failed: 0, dryRun: true };
    }

    // Live: POST then apply DPR guard per room
    const responses = await beds24<Beds24CalendarResponse[]>('POST', '/inventory/rooms/calendar', { body: payload });

    let done = 0, failed = 0;
    for (let i = 0; i < payload.length; i++) {
      const roomId = payload[i].roomId;
      const resp = Array.isArray(responses) ? responses[i] : undefined;
      const jobIds = roomIdToJobIds.get(roomId) ?? [];
      if (!jobIds.length) continue;

      const hasInv   = roomIdHasInv.get(roomId) ?? false;
      const hasPrice = roomIdHasPrice.get(roomId) ?? false;

      let numAvailOk = !hasInv;
      let price1Ok   = !hasPrice;
      for (const cal of resp?.modified?.calendar ?? []) {
        if ('numAvail' in cal) numAvailOk = true;
        if ('price1'   in cal) price1Ok   = true;
      }

      if (numAvailOk && price1Ok) {
        await markJobs(jobIds, 'done', null);
        done += jobIds.length;
      } else {
        const missing: string[] = [];
        if (!numAvailOk) missing.push('numAvail');
        if (!price1Ok)   missing.push('price1');
        await markJobs(jobIds, 'failed', `${missing.join(',')} dropped — missing DPR?`);
        failed += jobIds.length;
      }
    }

    return { done, failed, dryRun: false };
  } finally {
    localDraining = false;
  }
}

// Fire-and-forget trigger for Server Actions (Next.js 14 — no after() available).
// Safe to call without await; errors are logged but don't bubble to the caller.
export function triggerBeds24Push(): void {
  void runBeds24Push({ dryRun: false }).catch((e) =>
    console.error('[beds24-push] fire-and-forget error:', e)
  );
}
