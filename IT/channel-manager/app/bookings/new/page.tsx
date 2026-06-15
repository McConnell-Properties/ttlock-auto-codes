import { listProperties, listRoomTypes } from '@/lib/data';
import NewBookingForm from './form';

export const dynamic = 'force-dynamic';

export default async function NewBookingPage() {
  const [properties, roomTypes] = await Promise.all([listProperties(), listRoomTypes()]);

  const data = properties.map((p) => ({
    id: p.id,
    name: p.name,
    roomTypes: roomTypes
      .filter((rt) => rt.propertyId === p.id)
      .map((rt) => ({
        id: rt.id,
        name: rt.name,
        totalUnits: rt.totalUnits,
        basePrice: rt.basePrice,
      })),
  }));

  return (
    <>
      <h1>New booking</h1>
      <div className="card">
        <NewBookingForm properties={data} />
      </div>
    </>
  );
}
