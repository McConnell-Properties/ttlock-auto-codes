import { listProperties, getGrid, today, dateRange } from '@/lib/data';
import Link from 'next/link';
import CalendarGrid from './grid';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { property?: string; start?: string };
}) {
  const properties = await listProperties();
  const propertyId = searchParams.property || properties[0]?.id;
  const start = searchParams.start || today();
  const days = 14;
  const rows = propertyId ? await getGrid(propertyId, start, days) : [];
  const dates = dateRange(start, days);

  const shift = (n: number) => {
    const d = new Date(start + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  return (
    <>
      <h1>Availability & rates</h1>
      <div className="tabs">
        {properties.map((p) => (
          <Link
            key={p.id}
            href={`/calendar?property=${p.id}&start=${start}`}
            className={p.id === propertyId ? 'active' : ''}
          >
            {p.name}
          </Link>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Link className="btn secondary" href={`/calendar?property=${propertyId}&start=${shift(-14)}`} style={{ padding: '6px 12px' }}>← Prev 14</Link>
        <Link className="btn secondary" href={`/calendar?property=${propertyId}&start=${today()}`} style={{ padding: '6px 12px' }}>Today</Link>
        <Link className="btn secondary" href={`/calendar?property=${propertyId}&start=${shift(14)}`} style={{ padding: '6px 12px' }}>Next 14 →</Link>
      </div>
      <div className="card cal-wrap">
        <CalendarGrid rows={rows} dates={dates} />
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Click any cell to change the price or block/unblock rooms. Changes are queued in the{' '}
          <Link href="/sync">sync queue</Link> for pushing to Booking.com / Expedia.
        </p>
      </div>
    </>
  );
}
