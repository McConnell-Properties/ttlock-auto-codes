import { one, all } from './db';

// Return the first free physical room for a room type + stay window, or null
// if all rooms are occupied (overbooking). Candidates are sorted ascending so
// the assignment is stable across calls.
export async function assignRoom(
  roomTypeId: number,
  checkIn: string,
  checkOut: string,
  options?: { excludeBookingId?: number }
): Promise<string | null> {
  const rt = await one<{ propertyId: string; physicalRooms: string }>(
    `SELECT propertyId, physicalRooms FROM RoomType WHERE id = ?`,
    [roomTypeId]
  );
  if (!rt || !rt.physicalRooms) return null;

  const candidates = String(rt.physicalRooms)
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));

  if (candidates.length === 0) return null;

  const excludeSql = options?.excludeBookingId != null ? 'AND id != ?' : '';
  const occupied = await all<{ physicalRoom: string }>(
    `SELECT DISTINCT physicalRoom FROM Booking
     WHERE propertyId = ? AND status = 'confirmed'
       AND checkIn < ? AND checkOut > ?
       AND physicalRoom IS NOT NULL ${excludeSql}`,
    options?.excludeBookingId != null
      ? [rt.propertyId, checkOut, checkIn, options.excludeBookingId]
      : [rt.propertyId, checkOut, checkIn]
  );

  const occupiedSet = new Set(occupied.map((r) => String(r.physicalRoom)));
  return candidates.find((r) => !occupiedSet.has(r)) ?? null;
}
