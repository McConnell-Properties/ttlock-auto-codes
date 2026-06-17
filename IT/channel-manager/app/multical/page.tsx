import { listProperties, listRoomTypes, bookingsInWindowAll, ratesForWindow, dateRange, today } from '@/lib/data';
import Link from 'next/link';
import MultiCal from './multical';

export const dynamic = 'force-dynamic';

export default async function MultiCalPage({
  searchParams,
}: {
  searchParams: { start?: string };
}) {
  const start = searchParams.start || today();
  const days = 14;
  const end = dateRange(start, days + 1)[days];

  const [properties, roomTypes, bookings, rateRows] = await Promise.all([
    listProperties(),
    listRoomTypes(),
    bookingsInWindowAll(start, end),
    ratesForWindow(start, end),
  ]);

  // roomTypeId -> { date -> price } (override prices; basePrice is the fallback)
  const rates: Record<number, Record<string, number>> = {};
  for (const r of rateRows) {
    (rates[r.roomTypeId] = rates[r.roomTypeId] || {})[r.date] = r.price;
  }

  // property → room types (each with its physical rooms)
  const groups = properties.map((p) => ({
    id: p.id,
    name: p.name,
    types: roomTypes
      .filter((rt) => rt.propertyId === p.id)
      .map((rt) => ({
        id: rt.id,
        name: rt.name,
        basePrice: rt.basePrice,
        rooms: String(rt.physicalRooms).split(',').map((r) => r.trim())
          .sort((a, b) => Number(a) - Number(b)),
      })),
  }));

  const shift = (n: number) => {
    const d = new Date(start + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  return (
    <>
      <h1>Multi calendar — all properties</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Link className="btn secondary" href={`/multical?start=${shift(-7)}`} style={{ padding: '6px 12px' }}>← Back 7</Link>
        <Link className="btn secondary" href={`/multical?start=${today()}`} style={{ padding: '6px 12px' }}>Today</Link>
        <Link className="btn secondary" href={`/multical?start=${shift(3)}`} style={{ padding: '6px 12px' }}>Forward 3 →</Link>
        <span style={{ marginLeft: 8, display: 'inline-flex', gap: 10, fontSize: 12 }} className="muted">
          <span><i className="ch-dot ch-bdc" /> Booking.com</span>
          <span><i className="ch-dot ch-expedia" /> Expedia</span>
          <span><i className="ch-dot ch-airbnb" /> Airbnb</span>
          <span><i className="ch-dot ch-direct" /> Direct</span>
          <span><i className="ch-dot ch-other" /> Other/import</span>
        </span>
      </div>
      <MultiCal
        groups={groups}
        dates={dateRange(start, days)}
        rates={rates}
        bookings={bookings.map((b) => ({
          id: b.id,
          guestName: b.guestName,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          propertyId: b.propertyId,
          roomTypeId: b.roomTypeId,
          physicalRoom: b.physicalRoom,
          roomTypeName: b.roomTypeName,
          channel: b.channel,
          channelRef: b.channelRef,
          email: b.email,
          phone: b.phone,
          adults: b.adults,
          children: b.children,
          totalPrice: b.totalPrice,
          notes: b.notes,
          stripeStatus: b.stripeStatus,
          stripePaymentUrl: b.stripePaymentUrl,
        }))}
      />
    </>
  );
}
