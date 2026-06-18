import { arrivals, departures, extrasForDate, today } from '@/lib/data';
import Link from 'next/link';
import TasksDayView from './TasksDayView';

export const dynamic = 'force-dynamic';

function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const date = searchParams.date || today();
  const prev = shiftDate(date, -1);
  const next = shiftDate(date, 1);

  const [arrivalsList, departuresList, extrasList] = await Promise.all([
    arrivals(date),
    departures(date),
    extrasForDate(date),
  ]);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link className="btn secondary" href={`/tasks?date=${prev}`} style={{ padding: '6px 12px' }}>← Prev</Link>
        <h2 style={{ margin: 0, flex: 1, textAlign: 'center' }}>Tasks — {date}</h2>
        <Link className="btn secondary" href={`/tasks?date=${next}`} style={{ padding: '6px 12px' }}>Next →</Link>
      </div>

      <form method="get" action="/tasks" style={{ marginBottom: 20, display: 'flex', gap: 8 }}>
        <input type="date" name="date" defaultValue={date} style={{ flex: 1 }} />
        <button type="submit" className="btn secondary">Go</button>
        <Link className="btn secondary" href={`/tasks?date=${today()}`}>Today</Link>
      </form>

      {arrivalsList.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Check-ins</h3>
          {arrivalsList.map((b) => (
            <div key={b.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <strong>Room {b.physicalRoom ?? '?'}</strong>
              {' — '}{b.guestName}
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{b.propertyName}</span>
            </div>
          ))}
        </section>
      )}

      {departuresList.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Check-outs</h3>
          {departuresList.map((b) => (
            <div key={b.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <strong>Room {b.physicalRoom ?? '?'}</strong>
              {' — '}{b.guestName}
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{b.propertyName}</span>
            </div>
          ))}
        </section>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>
          Extras for {date}
          {extrasList.length > 0 && <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>({extrasList.length})</span>}
        </h3>
        {extrasList.length === 0 && (
          <p className="muted" style={{ margin: '0 0 10px' }}>No extras on this date.</p>
        )}
        <TasksDayView extras={extrasList} />
      </section>

      {arrivalsList.length === 0 && departuresList.length === 0 && extrasList.length === 0 && (
        <p className="muted" style={{ textAlign: 'center' }}>No tasks for this date.</p>
      )}
    </div>
  );
}
