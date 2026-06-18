'use client';

import { assignLanes, dayLabel, channelClass, shortName } from '@/lib/cal-utils';

type EB = {
  id: number;
  bookingId: number;
  extra: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  physicalRoom: string | null;
  channelRef: string | null;
  channel: string;
};

type ExtraRow = {
  id: string;
  label: string;
  capacity: number;
};

type Props = {
  extras: ExtraRow[];
  dates: string[];
  entries: EB[];
};

export default function ExtrasCal({ extras, dates, entries }: Props) {
  const windowStart = dates[0];

  return (
    <div className="card cal-wrap">
      <table className="cal mc">
        <thead>
          <tr>
            <th className="room-name">Extra</th>
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
          {extras.map((extra) => {
            const extraEntries = entries.filter((e) => e.extra === extra.id);
            const lanes = assignLanes(extraEntries);
            const rowCount = Math.max(extra.capacity, lanes.length);

            return (
              <>
                {/* Section header */}
                <tr key={`header-${extra.id}`} className="prop-header">
                  <td colSpan={dates.length + 1}>{extra.label}</td>
                </tr>

                {/* One row per capacity slot (plus overflow rows if over-capacity) */}
                {Array.from({ length: rowCount }, (_, laneIdx) => {
                  const lane = lanes[laneIdx] ?? [];
                  const isOverflow = laneIdx >= extra.capacity;

                  // Build a map of date → booking for this lane
                  const cellMap = new Map<string, EB>();
                  for (const bk of lane) {
                    let d = bk.checkIn;
                    while (d < bk.checkOut) {
                      cellMap.set(d, bk);
                      const dt = new Date(d + 'T00:00:00Z');
                      dt.setUTCDate(dt.getUTCDate() + 1);
                      d = dt.toISOString().slice(0, 10);
                    }
                  }

                  return (
                    <tr key={`${extra.id}-lane-${laneIdx}`}>
                      <td className="room-name" style={{ fontSize: 11, color: '#999' }}>
                        {isOverflow ? <span style={{ color: 'var(--red)' }}>overflow</span> : `Slot ${laneIdx + 1}`}
                      </td>
                      {dates.map((date) => {
                        const bk = cellMap.get(date);
                        const isStart = bk && (bk.checkIn === date || date === windowStart);
                        return (
                          <td
                            key={date}
                            className={[
                              'mc-cell',
                              bk ? channelClass(bk.channel) : '',
                              isOverflow && bk ? 'mc-over' : '',
                              bk && bk.checkIn === date ? 'mc-checkin' : '',
                            ].filter(Boolean).join(' ')}
                            title={bk ? `#${bk.bookingId} ${bk.guestName}${bk.physicalRoom ? ' · Room ' + bk.physicalRoom : ''}${bk.channelRef ? ' · ' + bk.channelRef : ''} · ${bk.checkIn}→${bk.checkOut}` : ''}
                          >
                            {bk && (
                              <span className={isStart ? 'mc-name' : 'mc-cont'}>
                                {isStart ? shortName(bk.guestName) : ' '}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
