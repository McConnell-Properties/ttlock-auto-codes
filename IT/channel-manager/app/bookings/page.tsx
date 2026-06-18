import { listBookings } from '@/lib/data';
import Link from 'next/link';
import CancelButton from './cancel-button';

export const dynamic = 'force-dynamic';

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: { status?: string; past?: string };
}) {
  const status = searchParams.status || 'confirmed';
  const includePast = searchParams.past === '1';
  const bookings = await listBookings(status, includePast);

  return (
    <>
      <h1>Bookings</h1>
      <div className="tabs">
        <Link href={`/bookings?status=confirmed${includePast ? '&past=1' : ''}`} className={status === 'confirmed' ? 'active' : ''}>Confirmed</Link>
        <Link href={`/bookings?status=cancelled${includePast ? '&past=1' : ''}`} className={status === 'cancelled' ? 'active' : ''}>Cancelled</Link>
        <Link href={`/bookings?status=all${includePast ? '&past=1' : ''}`} className={status === 'all' ? 'active' : ''}>All</Link>
        <Link href={`/bookings?status=${status}${includePast ? '' : '&past=1'}`} className={includePast ? 'active' : ''}>
          {includePast ? 'Hiding past' : 'Include past'}
        </Link>
      </div>
      <div className="card">
        {bookings.length === 0 ? (
          <p className="muted">No bookings found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Guest</th><th>Property</th><th>Room</th><th>Check-in</th><th>Check-out</th>
                <th>Channel</th><th>Ref</th><th>Total</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td>{b.guestName}</td>
                  <td>{b.propertyName}</td>
                  <td>
                    {b.roomTypeName ?? <span className="badge pending">unallocated</span>}
                    {b.physicalRoom ? <span className="muted"> &middot; Rm {b.physicalRoom}</span> : ''}
                    {b.units > 1 ? ` x${b.units}` : ''}
                  </td>
                  <td>{b.checkIn}</td>
                  <td>{b.checkOut}</td>
                  <td><span className={`badge ${b.channel === 'booking.com' ? 'bdc' : b.channel}`}>{b.channel}</span></td>
                  <td className="mono">{b.channelRef || '-'}</td>
                  <td>{b.totalPrice != null ? `${b.totalPrice}` : '-'}</td>
                  <td><span className={`badge ${b.status}`}>{b.status}</span></td>
                  <td>{b.status === 'confirmed' && <CancelButton id={b.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
