'use client';

import { useState, useTransition } from 'react';
import type { RoomTypeRow, DayCell } from '@/lib/data';
import { setPrice, setBlock } from '@/lib/actions';

function dayLabel(date: string) {
  const d = new Date(date + 'T00:00:00Z');
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return { wd, dm: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6 };
}

export default function CalendarGrid({ rows, dates }: { rows: RoomTypeRow[]; dates: string[] }) {
  const [edit, setEdit] = useState<{ row: RoomTypeRow; cell: DayCell } | null>(null);
  const [price, setPriceVal] = useState('');
  const [blocked, setBlockedVal] = useState('');
  const [pending, startTransition] = useTransition();

  const open = (row: RoomTypeRow, cell: DayCell) => {
    setEdit({ row, cell });
    setPriceVal(String(cell.price));
    setBlockedVal(String(cell.blocked));
  };

  const save = () => {
    if (!edit) return;
    const { row, cell } = edit;
    startTransition(async () => {
      const p = parseFloat(price);
      if (!Number.isNaN(p) && p !== cell.price) await setPrice(row.id, cell.date, p);
      const b = parseInt(blocked, 10);
      if (!Number.isNaN(b) && b !== cell.blocked) await setBlock(row.id, cell.date, b);
      setEdit(null);
    });
  };

  return (
    <>
      <table className="cal">
        <thead>
          <tr>
            <th className="room-name">Room type</th>
            {dates.map((d) => {
              const { wd, dm, weekend } = dayLabel(d);
              return (
                <th key={d} className={weekend ? 'weekend' : ''}>
                  {wd}<br />{dm}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="room-name">
                {row.name}
                <div className="sub">
                  {row.totalUnits} room{row.totalUnits > 1 ? 's' : ''} · base £{row.basePrice}
                  {!row.bdcRoomId && ' · BDC ID TBD'}
                </div>
              </td>
              {row.days.map((cell) => {
                const cls =
                  cell.available === 0 ? 'sold' : cell.available < row.totalUnits ? 'low' : 'ok';
                return (
                  <td
                    key={cell.date}
                    className={`cell ${cls}${cell.hasOverride ? ' override' : ''}`}
                    onClick={() => open(row, cell)}
                    title={`${cell.date}: ${cell.available} to sell (${cell.booked} booked, ${cell.blocked} blocked)`}
                  >
                    <div className="avail">{cell.available}</div>
                    <div className="price">£{cell.price}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {edit && (
        <div className="popover-back" onClick={() => setEdit(null)}>
          <div className="popover" onClick={(e) => e.stopPropagation()}>
            <h3>{edit.row.name}</h3>
            <div className="sub">
              {edit.cell.date} — {edit.cell.booked} booked, {edit.cell.available} to sell of {edit.row.totalUnits}
            </div>
            <label>Price per night (£)</label>
            <input type="number" step="1" min="0" value={price} onChange={(e) => setPriceVal(e.target.value)} />
            <label>Rooms blocked (manual close-out)</label>
            <input type="number" step="1" min="0" max={edit.row.totalUnits} value={blocked} onChange={(e) => setBlockedVal(e.target.value)} />
            <div className="row">
              <button onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save & queue sync'}</button>
              <button className="secondary" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
