export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { extrasWindowOccupancy, dateRange, today, listExtraCapacities } from '@/lib/data';
import { EXTRAS } from '@/lib/extras';
import ExtrasCal from './extras-cal';

export default async function ExtrasCalPage({
  searchParams,
}: {
  searchParams: { start?: string };
}) {
  const start = searchParams.start || today();
  const days = 14;
  const end = dateRange(start, days + 1)[days];

  const shift = (n: number) => {
    const d = new Date(start + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const [entries, capacities] = await Promise.all([
    extrasWindowOccupancy(start, end),
    listExtraCapacities(),
  ]);
  const capMap = Object.fromEntries(capacities.map((c) => [c.extraId, c.capacity]));

  const extras = EXTRAS.map((e) => ({
    id: e.id,
    label: e.label,
    capacity: capMap[e.id] ?? 1,
  }));

  return (
    <>
      <h1>Extras calendar</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Link className="btn secondary" href={`/extras-cal?start=${shift(-7)}`} style={{ padding: '6px 12px' }}>← Back 7</Link>
        <Link className="btn secondary" href={`/extras-cal?start=${today()}`} style={{ padding: '6px 12px' }}>Today</Link>
        <Link className="btn secondary" href={`/extras-cal?start=${shift(7)}`} style={{ padding: '6px 12px' }}>Forward 7 →</Link>
        <span style={{ marginLeft: 8, fontSize: 12 }} className="muted">
          Paid extras only — unpaid quotes are not shown.
        </span>
      </div>
      <ExtrasCal
        extras={extras}
        dates={dateRange(start, days)}
        entries={entries}
      />
    </>
  );
}
