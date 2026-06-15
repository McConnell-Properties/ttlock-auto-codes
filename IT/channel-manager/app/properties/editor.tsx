'use client';

import { useState, useTransition } from 'react';
import { updateRoomTypeIds, updatePropertyIds, setBasePrice } from '@/lib/actions';

type RT = {
  id: number;
  name: string;
  bdcRoomId: string | null;
  expediaName: string | null;
  physicalRooms: string;
  totalUnits: number;
  basePrice: number;
};

type Props = {
  property: {
    id: string;
    name: string;
    bdcHotelId: string | null;
    expediaHotelId: string | null;
    roomTypes: RT[];
  };
};

function RoomRow({ rt }: { rt: RT }) {
  const [bdc, setBdc] = useState(rt.bdcRoomId || '');
  const [exp, setExp] = useState(rt.expediaName || '');
  const [price, setPrice] = useState(String(rt.basePrice));
  const [pending, startTransition] = useTransition();
  const dirty = bdc !== (rt.bdcRoomId || '') || exp !== (rt.expediaName || '') || price !== String(rt.basePrice);

  return (
    <tr>
      <td>{rt.name}<div className="muted" style={{ fontSize: 11.5 }}>rooms {rt.physicalRooms} ({rt.totalUnits})</div></td>
      <td><input className="mono" style={{ width: 130 }} value={bdc} onChange={(e) => setBdc(e.target.value)} placeholder="TBD" /></td>
      <td><input style={{ width: 260 }} value={exp} onChange={(e) => setExp(e.target.value)} placeholder="not on Expedia" /></td>
      <td><input type="number" style={{ width: 80 }} value={price} onChange={(e) => setPrice(e.target.value)} /></td>
      <td>
        {dirty && (
          <button
            className="small"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await updateRoomTypeIds(rt.id, bdc.trim(), exp.trim());
                const p = parseFloat(price);
                if (!Number.isNaN(p) && p > 0 && p !== rt.basePrice) await setBasePrice(rt.id, p);
              })
            }
          >
            {pending ? '…' : 'Save'}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function PropertyEditor({ property }: Props) {
  const [bdcHotel, setBdcHotel] = useState(property.bdcHotelId || '');
  const [expHotel, setExpHotel] = useState(property.expediaHotelId || '');
  const [pending, startTransition] = useTransition();
  const dirty = bdcHotel !== (property.bdcHotelId || '') || expHotel !== (property.expediaHotelId || '');

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{property.name}</h2>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <label>BDC hotel_id</label>
          <input className="mono" style={{ width: 140 }} value={bdcHotel} onChange={(e) => setBdcHotel(e.target.value)} placeholder="TBD" />
        </div>
        <div>
          <label>Expedia property ID</label>
          <input className="mono" style={{ width: 140 }} value={expHotel} onChange={(e) => setExpHotel(e.target.value)} placeholder="not listed" />
        </div>
        {dirty && (
          <button
            disabled={pending}
            onClick={() => startTransition(() => updatePropertyIds(property.id, bdcHotel.trim(), expHotel.trim()))}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <table>
        <thead>
          <tr><th>Room type</th><th>BDC room ID</th><th>Expedia room name</th><th>Base £</th><th></th></tr>
        </thead>
        <tbody>
          {property.roomTypes.map((rt) => <RoomRow key={rt.id} rt={rt} />)}
        </tbody>
      </table>
    </div>
  );
}
