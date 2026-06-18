import { reportsByChannel, reportsByProperty, upcomingArrivals, reportsKpi } from '@/lib/data';

export const dynamic = 'force-dynamic';

const fmt = (n: number) =>
  n >= 1000 ? `£${(n / 1000).toFixed(1)}k` : `£${n.toFixed(0)}`;

export default async function ReportsPage() {
  const [kpi, channels, properties, arrivals] = await Promise.all([
    reportsKpi(),
    reportsByChannel(30),
    reportsByProperty(30),
    upcomingArrivals(7),
  ]);

  const totalRevenue30 = kpi?.revenue30 ?? 0;
  const totalBookings30 = kpi?.bookings30 ?? 0;
  const avg = totalBookings30 > 0 ? totalRevenue30 / totalBookings30 : 0;

  return (
    <>
      <h1>Reports</h1>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'In-house tonight', value: kpi?.currentGuests ?? 0 },
          { label: 'Arrivals today', value: kpi?.arrivalsToday ?? 0 },
          { label: 'Departures today', value: kpi?.departuresToday ?? 0 },
          { label: 'Unallocated (future)', value: kpi?.unallocatedFuture ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="card" style={{ textAlign: 'center', padding: '16px 12px' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{value}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Revenue KPIs */}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Last 30 days</h2>
          <div style={{ display: 'flex', gap: 28 }}>
            {[
              { label: 'Revenue', value: fmt(totalRevenue30) },
              { label: 'Bookings', value: String(totalBookings30) },
              { label: 'Avg value', value: fmt(avg) },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Arrivals next 7 days */}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Arrivals — next 7 days</h2>
          {arrivals.length === 0 ? (
            <p className="muted">No arrivals in the next 7 days.</p>
          ) : (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {arrivals.map((a) => (
                <div key={a.checkIn} style={{
                  padding: '6px 12px', borderRadius: 8,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  textAlign: 'center', minWidth: 64,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{a.count}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {new Date(a.checkIn + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* By channel */}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>By channel — last 30 days</h2>
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Channel</th>
                <th style={{ textAlign: 'right' }}>Bookings</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channel}>
                  <td>
                    <span className={`badge ${c.channel === 'booking.com' ? 'bdc' : c.channel}`}>
                      {c.channel}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{c.count}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* By property */}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>By property — last 30 days</h2>
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Property</th>
                <th style={{ textAlign: 'right' }}>Bookings</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td style={{ textAlign: 'right' }}>{p.count}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
