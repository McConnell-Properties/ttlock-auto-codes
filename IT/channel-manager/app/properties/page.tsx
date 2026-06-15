import { listProperties, listRoomTypes } from '@/lib/data';
import PropertyEditor from './editor';

export const dynamic = 'force-dynamic';

export default async function PropertiesPage() {
  const [props, allRoomTypes] = await Promise.all([listProperties(), listRoomTypes()]);
  const properties = props.map((p) => ({
    ...p,
    roomTypes: allRoomTypes.filter((rt) => rt.propertyId === p.id),
  }));

  return (
    <>
      <h1>Properties & channel mappings</h1>
      <p className="muted" style={{ marginBottom: 14 }}>
        Fill in missing BDC hotel/room IDs as you scrape them from the extranet. Room types without
        a BDC room ID can&apos;t get Booking.com sync jobs yet.
      </p>
      {properties.map((p) => (
        <PropertyEditor
          key={p.id}
          property={{
            id: p.id,
            name: p.name,
            bdcHotelId: p.bdcHotelId,
            expediaHotelId: p.expediaHotelId,
            roomTypes: p.roomTypes.map((rt) => ({
              id: rt.id,
              name: rt.name,
              bdcRoomId: rt.bdcRoomId,
              expediaName: rt.expediaName,
              physicalRooms: rt.physicalRooms,
              totalUnits: rt.totalUnits,
              basePrice: rt.basePrice,
            })),
          }}
        />
      ))}
    </>
  );
}
