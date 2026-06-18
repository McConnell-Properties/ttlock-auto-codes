/** Greedy interval stacking: assigns items to the minimum number of lanes
 *  so no two items in the same lane overlap (a.checkIn >= b.checkOut). */
export function assignLanes<T extends { checkIn: string; checkOut: string }>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));
  const lanes: T[][] = [];
  for (const item of sorted) {
    let placed = false;
    for (const lane of lanes) {
      if (item.checkIn >= lane[lane.length - 1].checkOut) {
        lane.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([item]);
  }
  return lanes;
}

export function dayLabel(date: string) {
  const d = new Date(date + 'T00:00:00Z');
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return { wd, dm: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6 };
}

export function channelClass(channel: string) {
  if (channel === 'booking.com') return 'bar-bdc';
  if (channel === 'expedia') return 'bar-expedia';
  if (channel === 'airbnb') return 'bar-airbnb';
  if (channel === 'direct') return 'bar-direct';
  return 'bar-other';
}

export function shortName(name: string) {
  const n = (name || '').replace(/^Imported.*$/, 'Imported').trim();
  return n.length > 18 ? n.slice(0, 17) + '…' : n || 'Guest';
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
