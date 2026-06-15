import * as data from '@/lib/data';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const t = data.today();
  const [arrivals, departures, staying, pendingSync, properties, roomTypes] = await Promise.all([
    data.arrivals(t),
    data.departures(t),
    data.occupiedUnits(t),
    data.pendingSyncCount(),
    data.listProperties(),
    data.listRoomTypes(),
  ]);

  const totalRooms = roomTypes.reduce((s, rt) => s + rt.totalUnits, 0);

  return (
    <>
      <h1>Dashboard — {t}</h1>
      <div className="stat-row">
        <div className="stat"><div className="num">{arrivals.length}</div><div className="lbl">Arrivals today</div></div>
        <div className="stat"><div className="num">{departures.length}</div><div className="lbl">Departures today</div></div>
        <div className="stat"><div className="num">{staying} / {totalRooms}</div><div className="lbl">Rooms occupied tonight</div></div>
        <div className="stat">
          <div className="num">{pendingSync}</div>
          <div className="lbl">{pendingSync > 0 ? <Link href="/sync">Pending sync jobs →</Link> : 'Pending sync jobs'}</div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Arrivals today</h2>
        {arrivals.length === 0 ? <p className="muted">None</p> : (
          <table>
            <thead><tr><th>Guest</th><th>Property</th><th>Room</th><th>Until</th><th>Channel</th></tr></thead>
            <tbody>
              {arrivals.map((b) => (
                <tr key={b.id}>
                  <td>{b.guestName}</td>
                  <td>{b.propertyName}</td>
                  <td>{b.roomTypeName}</td>
                  <td>{b.checkOut}</td>
                  <td><span className={`badge ${b.channel === 'booking.com' ? 'bdc' : b.channel}`}>{b.channel}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Departures today</h2>
        {departures.length === 0 ? <p className="muted">None</p> : (
          <table>
            <thead><tr><th>Guest</th><th>Property</th><th>Room</th><th>Channel</th></tr></thead>
            <tbody>
              {departures.map((b) => (
                <tr key={b.id}>
                  <td>{b.guestName}</td>
                  <td>{b.propertyName}</td>
                  <td>{b.roomTypeName}</td>
                  <td><span className={`badge ${b.channel === 'booking.com' ? 'bdc' : b.channel}`}>{b.channel}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Properties</h2>
        <table>
          <thead><tr><th>Property</th><th>Room types</th><th>Rooms</th><th>BDC</th><th>Expedia</th><th></th></tr></thead>
          <tbody>
            {properties.map((p) => {
              const rts = roomTypes.filter((rt) => rt.propertyId === p.id);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{rts.length}</td>
                  <td>{rts.reduce((s, rt) => s + rt.totalUnits, 0)}</td>
                  <td>{p.bdcHotelId ? <span className="badge done">linked</span> : <span className="badge pending">ID TBD</span>}</td>
                  <td>{p.expediaHotelId ? <span className="badge done">linked</span> : <span className="muted">—</span>}</td>
                  <td><Link href={`/calendar?property=${p.id}`}>Calendar →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
