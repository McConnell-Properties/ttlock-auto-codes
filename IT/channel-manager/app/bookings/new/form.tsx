'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBooking } from '@/lib/actions';

type Props = {
  properties: {
    id: string;
    name: string;
    roomTypes: { id: number; name: string; totalUnits: number; basePrice: number }[];
  }[];
};

export default function NewBookingForm({ properties }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [propertyId, setPropertyId] = useState(properties[0]?.id || '');
  const prop = properties.find((p) => p.id === propertyId);
  const [roomTypeId, setRoomTypeId] = useState<number>(prop?.roomTypes[0]?.id || 0);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const checkIn = String(f.get('checkIn'));
    const checkOut = String(f.get('checkOut'));
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      setError('Check-out must be after check-in.');
      return;
    }
    setError('');
    startTransition(async () => {
      await createBooking({
        roomTypeId: Number(f.get('roomTypeId')),
        guestName: String(f.get('guestName')),
        email: String(f.get('email') || ''),
        phone: String(f.get('phone') || ''),
        checkIn,
        checkOut,
        units: Number(f.get('units') || 1),
        channel: String(f.get('channel')),
        channelRef: String(f.get('channelRef') || ''),
        totalPrice: f.get('totalPrice') ? Number(f.get('totalPrice')) : undefined,
        notes: String(f.get('notes') || ''),
      });
      router.push('/bookings');
    });
  };

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <div>
          <label>Property</label>
          <select
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              const p = properties.find((x) => x.id === e.target.value);
              setRoomTypeId(p?.roomTypes[0]?.id || 0);
            }}
          >
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label>Room type</label>
          <select name="roomTypeId" value={roomTypeId} onChange={(e) => setRoomTypeId(Number(e.target.value))}>
            {prop?.roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>{rt.name} ({rt.totalUnits} rooms)</option>
            ))}
          </select>
        </div>
        <div>
          <label>Guest name *</label>
          <input name="guestName" required />
        </div>
        <div>
          <label>Rooms (units)</label>
          <input name="units" type="number" min="1" defaultValue="1" />
        </div>
        <div>
          <label>Check-in *</label>
          <input name="checkIn" type="date" required />
        </div>
        <div>
          <label>Check-out *</label>
          <input name="checkOut" type="date" required />
        </div>
        <div>
          <label>Email</label>
          <input name="email" type="email" />
        </div>
        <div>
          <label>Phone</label>
          <input name="phone" />
        </div>
        <div>
          <label>Channel *</label>
          <select name="channel" defaultValue="direct">
            <option value="direct">Direct</option>
            <option value="booking.com">Booking.com</option>
            <option value="expedia">Expedia</option>
          </select>
        </div>
        <div>
          <label>Channel reference</label>
          <input name="channelRef" placeholder="e.g. BDC confirmation no." />
        </div>
        <div>
          <label>Total price (£)</label>
          <input name="totalPrice" type="number" step="0.01" min="0" />
        </div>
        <div>
          <label>Notes</label>
          <input name="notes" />
        </div>
      </div>
      {error && <p style={{ color: 'var(--red)', marginTop: 10 }}>{error}</p>}
      <p className="muted" style={{ marginTop: 12, fontSize: 12.5 }}>
        Saving queues inventory pushes to the other channels automatically (origin channel is skipped — it already has the booking).
      </p>
      <div style={{ marginTop: 12 }}>
        <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save booking'}</button>
      </div>
    </form>
  );
}
