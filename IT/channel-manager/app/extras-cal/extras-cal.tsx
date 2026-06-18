'use client';

import { useState, useTransition, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { assignLanes, dayLabel, channelClass, shortName } from '@/lib/cal-utils';
import { createExtrasRequestAction, deleteExtrasRequestAction } from '@/lib/actions';

type EB = {
  id: number;
  bookingId: number;
  extra: string;
  bookingReference: string | null;
  checkIn: string;
  checkOut: string;
  guestName: string;
  physicalRoom: string | null;
  channelRef: string | null;
  channel: string;
  propertyName: string;
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

type DragState = {
  extraId: string;
  start: string;
  end: string;
} | null;

type ModalBooking = {
  id: number;
  guestName: string;
  checkIn: string;
  checkOut: string;
  physicalRoom: string | null;
  propertyName: string;
  channel: string;
};

type BookingModal = {
  extraId: string;
  extraLabel: string;
  start: string;
  end: string;
  bookings: ModalBooking[];
  alreadyLinked: Set<number>;
};

type DetailModal = {
  entry: EB;
  extraLabel: string;
};

export default function ExtrasCal({ extras, dates, entries }: Props) {
  const windowStart = dates[0];
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [drag, setDrag] = useState<DragState>(null);
  const dragRef = useRef<DragState>(null);
  dragRef.current = drag;

  const [bookingModal, setBookingModal] = useState<BookingModal | null>(null);
  const [detailModal, setDetailModal] = useState<DetailModal | null>(null);
  const [loadingModal, setLoadingModal] = useState(false);

  const minMax = (a: string, b: string): [string, string] => a < b ? [a, b] : [b, a];

  const isDragSelected = (extraId: string, date: string) => {
    if (!drag || drag.extraId !== extraId) return false;
    const [lo, hi] = minMax(drag.start, drag.end);
    return date >= lo && date <= hi;
  };

  const openBookingModal = useCallback(async (extraId: string, start: string, end: string) => {
    setLoadingModal(true);
    const extraDef = extras.find((e) => e.id === extraId);
    const [lo, hi] = minMax(start, end);
    const checkOutEnd = (() => {
      const d = new Date(hi + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    const alreadyLinked = new Set(
      entries.filter((e) => e.extra === extraId).map((e) => e.bookingId)
    );
    try {
      const res = await fetch(`/api/bookings-in-range?start=${lo}&end=${checkOutEnd}`);
      const { bookings } = await res.json();
      setBookingModal({
        extraId,
        extraLabel: extraDef?.label ?? extraId,
        start: lo,
        end: hi,
        bookings,
        alreadyLinked,
      });
    } finally {
      setLoadingModal(false);
    }
  }, [extras, entries]);

  const handleMouseDown = (extraId: string, date: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setDrag({ extraId, start: date, end: date });
  };

  const handleMouseEnter = (extraId: string, date: string) => () => {
    setDrag((prev) => {
      if (!prev || prev.extraId !== extraId) return prev;
      return { ...prev, end: date };
    });
  };

  const handleMouseUp = (extraId: string, date: string) => () => {
    const d = dragRef.current;
    if (!d || d.extraId !== extraId) { setDrag(null); return; }
    const [lo, hi] = minMax(d.start, date);
    setDrag(null);
    openBookingModal(extraId, lo, hi);
  };

  const attach = (bookingId: number) => {
    if (!bookingModal) return;
    const extraId = bookingModal.extraId;
    setBookingModal(null);
    startTransition(async () => {
      await createExtrasRequestAction(bookingId, extraId);
      router.refresh();
    });
  };

  const remove = (entry: EB) => {
    if (!confirm(`Remove this extra from ${entry.guestName}?`)) return;
    setDetailModal(null);
    startTransition(async () => {
      await deleteExtrasRequestAction(entry.id);
      router.refresh();
    });
  };

  const isManual = (entry: EB) =>
    entry.bookingReference?.startsWith('MANUAL-') ?? false;

  return (
    <>
      {isPending && <div className="mc-saving">Saving…</div>}

      <div className="card cal-wrap mc-wrap" onMouseLeave={() => setDrag(null)}>
        <table className="cal mc" style={{ userSelect: 'none' }}>
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
                  <tr key={`header-${extra.id}`} className="mc-prop">
                    <td colSpan={dates.length + 1}>{extra.label}</td>
                  </tr>

                  {Array.from({ length: rowCount }, (_, laneIdx) => {
                    const lane = lanes[laneIdx] ?? [];
                    const isOverflow = laneIdx >= extra.capacity;

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
                          {isOverflow
                            ? <span style={{ color: 'var(--red)' }}>overflow</span>
                            : `Slot ${laneIdx + 1}`}
                        </td>
                        {dates.map((date) => {
                          const bk = cellMap.get(date);
                          const isStart = bk && (bk.checkIn === date || date === windowStart);
                          const selected = isDragSelected(extra.id, date);
                          return (
                            <td
                              key={date}
                              className={[
                                'mc-cell',
                                bk ? channelClass(bk.channel) : '',
                                isOverflow && bk ? 'mc-over' : '',
                                bk && bk.checkIn === date ? 'mc-checkin' : '',
                                !bk && selected ? 'mc-sel' : '',
                              ].filter(Boolean).join(' ')}
                              title={bk
                                ? `${bk.guestName} · ${bk.checkIn}→${bk.checkOut}`
                                : 'Drag to attach extra to a booking'}
                              onClick={bk ? () => setDetailModal({ entry: bk, extraLabel: extra.label }) : undefined}
                              onMouseDown={!bk ? handleMouseDown(extra.id, date) : undefined}
                              onMouseEnter={!bk ? handleMouseEnter(extra.id, date) : undefined}
                              onMouseUp={!bk ? handleMouseUp(extra.id, date) : undefined}
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

      {/* Loading overlay */}
      {loadingModal && (
        <div className="popover-back">
          <div className="popover" style={{ textAlign: 'center', padding: 32 }}>
            Loading bookings…
          </div>
        </div>
      )}

      {/* Booking picker modal */}
      {bookingModal && (
        <div className="popover-back" onClick={() => setBookingModal(null)}>
          <div className="popover" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3>Add {bookingModal.extraLabel}</h3>
            <p className="sub">{bookingModal.start} → {bookingModal.end} · pick a booking to attach this extra to</p>

            {bookingModal.bookings.length === 0 ? (
              <p style={{ marginTop: 16, color: 'var(--muted)', fontSize: 13 }}>
                No confirmed bookings overlap these dates.
              </p>
            ) : (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
                {bookingModal.bookings.map((b) => {
                  const already = bookingModal.alreadyLinked.has(b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() => !already && attach(b.id)}
                      disabled={already}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)',
                        background: already ? '#f6f7f9' : '#fff', cursor: already ? 'default' : 'pointer',
                        opacity: already ? 0.6 : 1, textAlign: 'left',
                      }}
                    >
                      <span>
                        <strong style={{ fontSize: 13 }}>{b.guestName}</strong>
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>
                          #{b.id} · {b.checkIn} → {b.checkOut}
                          {b.physicalRoom ? ` · Room ${b.physicalRoom}` : ''}
                          {' · '}{b.propertyName}
                        </span>
                      </span>
                      {already
                        ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>already added</span>
                        : <span style={{ fontSize: 11, color: 'var(--accent)' }}>+ attach</span>}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="row" style={{ marginTop: 16 }}>
              <button className="secondary" onClick={() => setBookingModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail / remove modal */}
      {detailModal && (
        <div className="popover-back" onClick={() => setDetailModal(null)}>
          <div className="popover" onClick={(e) => e.stopPropagation()}>
            <h3>{detailModal.extraLabel}</h3>
            <p className="sub" style={{ marginBottom: 14 }}>
              {isManual(detailModal.entry) ? 'Manually assigned' : 'Booked through checkout'}
            </p>

            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Guest', detailModal.entry.guestName],
                  ['Booking', `#${detailModal.entry.bookingId}`],
                  ['Dates', `${detailModal.entry.checkIn} → ${detailModal.entry.checkOut}`],
                  ['Room', detailModal.entry.physicalRoom ? `Room ${detailModal.entry.physicalRoom}` : '—'],
                  ['Property', detailModal.entry.propertyName],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ color: 'var(--muted)', paddingBottom: 7, paddingRight: 14, whiteSpace: 'nowrap' }}>{label}</td>
                    <td style={{ paddingBottom: 7, fontWeight: 500 }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="row" style={{ marginTop: 6 }}>
              <a
                href={`/bookings/${detailModal.entry.bookingId}`}
                className="btn secondary"
                style={{ fontSize: 13, padding: '6px 12px' }}
              >
                View booking
              </a>
              <button
                className="danger"
                style={{ fontSize: 13, padding: '6px 12px' }}
                onClick={() => remove(detailModal.entry)}
              >
                Remove extra
              </button>
              <button className="secondary" style={{ fontSize: 13, padding: '6px 12px' }} onClick={() => setDetailModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
