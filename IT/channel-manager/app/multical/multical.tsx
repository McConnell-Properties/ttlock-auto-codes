'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { moveBookingAction, updateBookingAction, quoteAction, cancelBooking, createBooking, sendPaymentLinkAction, syncStripeAction } from '@/lib/actions';

type B = {
  id: number;
  guestName: string;
  checkIn: string;
  checkOut: string;
  propertyId: string;
  roomTypeId: number | null;
  physicalRoom: string | null;
  roomTypeName: string | null;
  channel: string;
  channelRef: string | null;
  email: string | null;
  phone: string | null;
  adults: number;
  children: number;
  totalPrice: number | null;
  notes: string | null;
  stripeStatus: string | null;
  stripePaymentUrl: string | null;
  originPropertyId: string | null;
  originRoomTypeId: number | null;
  originPhysicalRoom: string | null;
};

type Group = {
  id: string;
  name: string;
  types: { id: number; name: string; basePrice: number; rooms: string[] }[];
};

type Quote = {
  roomTypeId: number;
  available: number;
  nights: number;
  adults: number;
  children: number;
  baseTotal: number;
  directPct: number;
  directDiscount: number;
  losPct: number;
  losDiscount: number;
  guestFees: number;
  promoCode: string | null;
  promoValid: boolean | null;
  promoDiscount: number;
  totalPrice: number;
} | null;

type RowTarget = { propertyId: string; physicalRoom: string | null; roomTypeId: number | null };

type Props = {
  groups: Group[];
  dates: string[];
  rates: Record<number, Record<string, number>>;
  bookings: B[];
};

/** Greedy interval stacking: assigns bookings to the minimum number of lanes
 *  so no two bookings in the same lane overlap (checkIn >= last.checkOut). */
function assignLanes(bookings: B[]): B[][] {
  const sorted = [...bookings].sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));
  const lanes: B[][] = [];
  for (const bk of sorted) {
    let placed = false;
    for (const lane of lanes) {
      if (bk.checkIn >= lane[lane.length - 1].checkOut) {
        lane.push(bk);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([bk]);
  }
  return lanes;
}

function dayLabel(date: string) {
  const d = new Date(date + 'T00:00:00Z');
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return { wd, dm: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6 };
}

function channelClass(channel: string) {
  if (channel === 'booking.com') return 'bar-bdc';
  if (channel === 'expedia') return 'bar-expedia';
  if (channel === 'airbnb') return 'bar-airbnb';
  if (channel === 'direct') return 'bar-direct';
  return 'bar-other';
}

function shortName(name: string) {
  const n = (name || '').replace(/^Imported.*$/, 'Imported').trim();
  return n.length > 18 ? n.slice(0, 17) + '…' : n || 'Guest';
}

function addDays(date: string, n: number) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysDiff(a: string, b: string) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export default function MultiCal({ groups, dates: initDates, rates: initRates, bookings: initBookings }: Props) {
  const router = useRouter();
  const [dates, setDates] = useState(initDates);
  const [bookings, setBookings] = useState(initBookings);
  const [rates, setRates] = useState(initRates);
  const calWrapRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const datesRef = useRef(initDates);
  datesRef.current = dates;

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const last = datesRef.current[datesRef.current.length - 1];
    const d = new Date(last + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    const nextStart = d.toISOString().slice(0, 10);
    try {
      const res = await fetch(`/api/multical/extend?start=${nextStart}&days=14`);
      if (!res.ok) return;
      const data = await res.json();
      setDates((prev) => [...prev, ...data.dates]);
      setBookings((prev) => {
        const seen = new Set(prev.map((b: B) => b.id));
        return [...prev, ...data.bookings.filter((b: B) => !seen.has(b.id))];
      });
      setRates((prev) => {
        const m = { ...prev };
        for (const [id, map] of Object.entries(data.rates as Record<string, Record<string, number>>))
          m[Number(id)] = { ...(m[Number(id)] || {}), ...(map as Record<string, number>) };
        return m;
      });
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const el = calWrapRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 200) loadMore();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [loadMore]);

  const [sel, setSel] = useState<B | null>(null);
  const [edit, setEdit] = useState({
    room: '', ci: '', co: '', guestName: '', email: '', phone: '',
    adults: '1', children: '0', totalPrice: '', notes: '',
  });
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragDate, setDragDate] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  // drag-select on empty cells → quote/new booking
  const [selDrag, setSelDrag] = useState<{ target: RowTarget; anchor: string; focus: string } | null>(null);
  const [newBk, setNewBk] = useState<{ target: RowTarget; ci: string; co: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const windowStart = dates[0];

  const open = (b: B) => {
    setSel(b);
    setEdit({
      room: b.physicalRoom ?? '',
      ci: b.checkIn,
      co: b.checkOut,
      guestName: b.guestName,
      email: b.email ?? '',
      phone: b.phone ?? '',
      adults: String(b.adults ?? 1),
      children: String(b.children ?? 0),
      totalPrice: b.totalPrice != null ? String(b.totalPrice) : '',
      notes: (b.notes ?? '').replace('[reservation_status]', '').trim(),
    });
  };

  const doMove = (bookingId: number, t: RowTarget & { checkIn?: string; checkOut?: string }) => {
    startTransition(async () => {
      const r = await moveBookingAction(bookingId, t, false);
      if (!r.ok && r.conflicts) {
        const msg =
          `That room already has:\n` +
          r.conflicts.map((c) => `  • #${c.id} ${c.guestName} (${c.checkIn} → ${c.checkOut})`).join('\n') +
          `\n\nMove anyway (double-booked)?`;
        if (confirm(msg)) await moveBookingAction(bookingId, t, true);
      }
      router.refresh();
    });
  };

  const dropMove = (bookingId: number, rowTarget: RowTarget, dropDate: string) => {
    const b = bookings.find((x) => x.id === bookingId);
    if (!b) return;
    const delta = dragDate ? daysDiff(dragDate, dropDate) : 0;
    const t: RowTarget & { checkIn?: string; checkOut?: string } = { ...rowTarget };
    if (delta !== 0) {
      t.checkIn = addDays(b.checkIn, delta);
      t.checkOut = addDays(b.checkOut, delta);
    }
    doMove(bookingId, t);
  };

  const saveEdit = () => {
    if (!sel) return;
    const s = sel;
    const e = edit;
    setSel(null);
    startTransition(async () => {
      await updateBookingAction(s.id, {
        guestName: e.guestName.trim() || undefined,
        email: e.email.trim() || null,
        phone: e.phone.trim() || null,
        adults: Math.max(1, Number(e.adults) || 1),
        children: Math.max(0, Number(e.children) || 0),
        totalPrice: e.totalPrice.trim() === '' ? null : Number(e.totalPrice),
        notes: e.notes.trim() || null,
      });
      const roomChanged = (e.room || null) !== s.physicalRoom;
      const datesChanged = e.ci !== s.checkIn || e.co !== s.checkOut;
      if (roomChanged || datesChanged) {
        const r = await moveBookingAction(s.id, {
          propertyId: s.propertyId,
          physicalRoom: e.room || null,
          roomTypeId: s.roomTypeId,
          checkIn: e.ci,
          checkOut: e.co,
        }, false);
        if (!r.ok && r.conflicts) {
          const msg =
            `That room already has:\n` +
            r.conflicts.map((c) => `  • #${c.id} ${c.guestName} (${c.checkIn} → ${c.checkOut})`).join('\n') +
            `\n\nMove anyway (double-booked)?`;
          if (confirm(msg)) {
            await moveBookingAction(s.id, {
              propertyId: s.propertyId, physicalRoom: e.room || null, roomTypeId: s.roomTypeId,
              checkIn: e.ci, checkOut: e.co,
            }, true);
          }
        }
      }
      router.refresh();
    });
  };

  const doCancel = () => {
    if (!sel) return;
    const s = sel;
    if (!confirm(`Cancel booking #${s.id} (${s.guestName})? Availability will be restored and OTA pushes queued.`)) return;
    setSel(null);
    startTransition(async () => {
      await cancelBooking(s.id);
      router.refresh();
    });
  };

  const rowKey = (t: RowTarget) => `${t.propertyId}|${t.physicalRoom ?? ''}|${t.roomTypeId ?? ''}`;

  const finishSelect = () => {
    if (!selDrag) return;
    const [a, b] = [selDrag.anchor, selDrag.focus].sort();
    setNewBk({ target: selDrag.target, ci: a, co: addDays(b, 1) });
    setSelDrag(null);
  };

  const inSelection = (rowTarget: RowTarget, date: string) => {
    if (!selDrag || rowKey(selDrag.target) !== rowKey(rowTarget)) return false;
    const [a, b] = [selDrag.anchor, selDrag.focus].sort();
    return date >= a && date <= b;
  };

  const renderCells = (
    occ: (date: string) => B[],
    rowTarget: RowTarget,
    allowOverlapWarn: boolean,
    conflictOcc?: (date: string) => B[]
  ) =>
    dates.map((date) => {
      const list = occ(date);
      const fullList = conflictOcc ? conflictOcc(date) : list;
      const b = list[0];
      const over = allowOverlapWarn && fullList.length > 1 && !!b;
      const isStart = b && (b.checkIn === date || date === windowStart);
      const highlighted = overKey === rowKey(rowTarget) && dragId !== null;
      const selected = !b && inSelection(rowTarget, date);
      return (
        <td
          key={date}
          className={`mc-cell${b ? ' ' + channelClass(b.channel) : ''}${over ? ' mc-over' : ''}${b && b.checkIn === date ? ' mc-checkin' : ''}${highlighted ? ' mc-drop' : ''}${selected ? ' mc-sel' : ''}`}
          title={fullList.map((x) => `#${x.id} ${x.guestName} · ${x.checkIn}→${x.checkOut} · ${x.channel}${x.channelRef ? ' · ' + x.channelRef : ''}`).join('\n')}
          onClick={() => b && open(b)}
          onMouseDown={(e) => {
            if (!b && rowTarget.physicalRoom) {
              e.preventDefault();
              setSelDrag({ target: rowTarget, anchor: date, focus: date });
            }
          }}
          onMouseEnter={() => {
            if (selDrag && rowKey(selDrag.target) === rowKey(rowTarget)) {
              setSelDrag({ ...selDrag, focus: date });
            }
          }}
          onMouseUp={finishSelect}
          onDragOver={(e) => { e.preventDefault(); setOverKey(rowKey(rowTarget)); }}
          onDragLeave={() => setOverKey((k) => (k === rowKey(rowTarget) ? null : k))}
          onDrop={(e) => {
            e.preventDefault();
            setOverKey(null);
            const id = Number(e.dataTransfer.getData('text/booking-id') || dragId);
            if (id) dropMove(id, rowTarget, date);
            setDragId(null);
            setDragDate(null);
          }}
        >
          {b && (
            <span
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/booking-id', String(b.id));
                e.dataTransfer.effectAllowed = 'move';
                setDragId(b.id);
                setDragDate(date);
              }}
              onDragEnd={() => { setDragId(null); setDragDate(null); setOverKey(null); }}
              className={isStart ? 'mc-name' : 'mc-cont'}
            >
              {isStart ? shortName(b.guestName) : ' '}
              {isStart && b.originPhysicalRoom ? <span className="mc-moved" title={`Moved from room ${b.originPhysicalRoom}`}>↗</span> : null}
            </span>
          )}
        </td>
      );
    });

  return (
    <>
      {pending && <div className="mc-saving">Saving…</div>}
      <div ref={calWrapRef} className="card cal-wrap">
      <table className="cal mc" onMouseLeave={() => setSelDrag(null)}>
        <thead>
          <tr>
            <th className="room-name">Room</th>
            {dates.map((d) => {
              const { wd, dm, weekend } = dayLabel(d);
              return <th key={d} className={weekend ? 'weekend' : ''}>{wd}<br />{dm}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const propBookings = bookings.filter((b) => b.propertyId === g.id);
            const untyped = propBookings.filter((b) => b.roomTypeId == null);
            return (
              <PropertyRows
                key={g.id}
                group={g}
                propBookings={propBookings}
                untyped={untyped}
                dates={dates}
                rates={rates}
                renderCells={renderCells}
              />
            );
          })}
        </tbody>
      </table>
      </div>

      {newBk && (
        <NewBookingModal
          groups={groups}
          target={newBk.target}
          initCi={newBk.ci}
          initCo={newBk.co}
          onClose={() => setNewBk(null)}
          onCreated={() => { setNewBk(null); router.refresh(); }}
        />
      )}

      {sel && (
        <div className="popover-back" onClick={() => setSel(null)}>
          <div className="popover" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
            <h3>#{sel.id} — {sel.guestName}</h3>
            <div className="sub">
              <span className={`badge ${sel.channel === 'booking.com' ? 'bdc' : sel.channel}`}>{sel.channel}</span>
              {sel.channelRef ? <> · <span className="mono">{sel.channelRef}</span></> : null}
              {sel.roomTypeName ? <> · {sel.roomTypeName}</> : ' · no room type'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>Guest name</label>
                <input value={edit.guestName} onChange={(e) => setEdit({ ...edit, guestName: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Room</label>
                <select value={edit.room} onChange={(e) => setEdit({ ...edit, room: e.target.value })}>
                  <option value="">— Unassigned —</option>
                  {groups.find((g) => g.id === sel.propertyId)?.types.map((t) => (
                    <optgroup key={t.id} label={t.name + (sel.roomTypeId === t.id ? ' (booked type)' : '')}>
                      {t.rooms.map((r) => <option key={r} value={r}>Room {r}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>Check-in</label>
                <input type="date" value={edit.ci} onChange={(e) => setEdit({ ...edit, ci: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Check-out</label>
                <input type="date" value={edit.co} onChange={(e) => setEdit({ ...edit, co: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>Adults</label>
                <input type="number" min="1" value={edit.adults} onChange={(e) => setEdit({ ...edit, adults: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Children</label>
                <input type="number" min="0" value={edit.children} onChange={(e) => setEdit({ ...edit, children: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Total £</label>
                <input type="number" step="0.01" value={edit.totalPrice} onChange={(e) => setEdit({ ...edit, totalPrice: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>Email</label>
                <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Phone</label>
                <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
              </div>
            </div>
            <label>Notes</label>
            <input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />

            <div style={{ marginTop: 12, padding: '10px 12px', background: '#f6f7f9', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12.5 }}>Payment:</strong>
              {sel.stripeStatus === 'paid' && <span className="badge done">paid ✓</span>}
              {sel.stripeStatus === 'link_sent' && <span className="badge pending">link sent — awaiting payment</span>}
              {sel.stripeStatus === 'expired' && <span className="badge failed">link expired</span>}
              {!sel.stripeStatus && <span className="muted" style={{ fontSize: 12.5 }}>no payment link</span>}
              {sel.stripeStatus !== 'paid' && (
                <button
                  className="small"
                  disabled={pending}
                  onClick={() => {
                    const s = sel;
                    startTransition(async () => {
                      const r = await sendPaymentLinkAction(s.id);
                      if (!r.ok) alert(`Could not send payment link:\n${r.error}`);
                      else alert('Payment link emailed to the guest.');
                      router.refresh();
                    });
                  }}
                >
                  {sel.stripeStatus ? 'Send new link' : 'Email payment link'}
                </button>
              )}
              {sel.stripeStatus === 'link_sent' && (
                <button
                  className="small secondary"
                  disabled={pending}
                  onClick={() => startTransition(async () => {
                    const r = await syncStripeAction();
                    alert(`Stripe sync: ${r.checked} checked, ${r.paid} paid, ${r.expired} expired${r.errors.length ? `\n${r.errors.join('\n')}` : ''}`);
                    router.refresh();
                  })}
                >
                  Check status
                </button>
              )}
            </div>

            {sel.originPhysicalRoom && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#fff8e1', borderRadius: 6, fontSize: 12.5 }}>
                <span className="badge" style={{ background: '#f59e0b', color: '#fff', marginRight: 6 }}>moved</span>
                Origin: {groups.find((g) => g.id === sel.originPropertyId)?.name ?? sel.originPropertyId} · Room {sel.originPhysicalRoom}
              </div>
            )}

            <div className="row">
              <button disabled={pending || !edit.ci || !edit.co || edit.co <= edit.ci} onClick={saveEdit}>
                {pending ? 'Saving…' : 'Save'}
              </button>
              <button className="secondary" onClick={() => setSel(null)}>Close</button>
              <button className="danger" style={{ marginLeft: 'auto' }} disabled={pending} onClick={doCancel}>
                Cancel booking
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Drag-selected empty nights → live quote → optionally a confirmed booking
function NewBookingModal({
  groups,
  target,
  initCi,
  initCo,
  onClose,
  onCreated,
}: {
  groups: Group[];
  target: RowTarget;
  initCi: string;
  initCo: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [ci, setCi] = useState(initCi);
  const [co, setCo] = useState(initCo);
  const [adults, setAdults] = useState('1');
  const [children, setChildren] = useState('0');
  const [guestName, setGuestName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('direct');
  const [priceOverride, setPriceOverride] = useState('');
  const [notes, setNotes] = useState('');
  const [promo, setPromo] = useState('');
  const [sendLink, setSendLink] = useState(false);
  const [quote, setQuote] = useState<Quote>(null);
  const [pending, startTransition] = useTransition();

  const g = groups.find((x) => x.id === target.propertyId);
  const t = g?.types.find((x) => x.id === target.roomTypeId);

  const valid = Boolean(ci && co && co > ci && target.roomTypeId);

  useEffect(() => {
    if (!valid || !target.roomTypeId) { setQuote(null); return; }
    let stale = false;
    quoteAction(
      target.roomTypeId, ci, co,
      Math.max(1, Number(adults) || 1),
      Math.max(0, Number(children) || 0),
      promo.trim() || null
    ).then((q) => { if (!stale) setQuote(q); });
    return () => { stale = true; };
  }, [ci, co, adults, children, promo, target.roomTypeId, valid]);

  const create = () => {
    if (!target.roomTypeId) return;
    if (!guestName.trim()) { alert('Guest name is required for a booking.'); return; }
    startTransition(async () => {
      const id = await createBooking({
        roomTypeId: target.roomTypeId!,
        guestName: guestName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        checkIn: ci,
        checkOut: co,
        units: 1,
        adults: Math.max(1, Number(adults) || 1),
        children: Math.max(0, Number(children) || 0),
        channel,
        totalPrice: priceOverride.trim() !== '' ? Number(priceOverride) : quote?.totalPrice,
        notes: [notes.trim(), quote?.promoCode ? `promo:${quote.promoCode}` : ''].filter(Boolean).join(' · ') || undefined,
      });
      if (target.physicalRoom) {
        const r = await moveBookingAction(id, target, false);
        if (!r.ok && r.conflicts) {
          const msg =
            `Room ${target.physicalRoom} already has:\n` +
            r.conflicts.map((c) => `  • #${c.id} ${c.guestName} (${c.checkIn} → ${c.checkOut})`).join('\n') +
            `\n\nAssign anyway (double-booked)? Cancel leaves it unassigned.`;
          if (confirm(msg)) await moveBookingAction(id, target, true);
        }
      }
      if (sendLink && email.trim()) {
        const lr = await sendPaymentLinkAction(id);
        if (!lr.ok) alert(`Booking created, but the payment link failed:\n${lr.error}`);
        else alert('Booking created and payment link emailed to the guest.');
      }
      onCreated();
    });
  };

  return (
    <div className="popover-back" onClick={onClose}>
      <div className="popover" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
        <h3>New stay — {g?.name}, Room {target.physicalRoom}</h3>
        <div className="sub">{t?.name}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label>Check-in</label>
            <input type="date" value={ci} onChange={(e) => setCi(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Check-out</label>
            <input type="date" value={co} onChange={(e) => setCo(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label>Adults</label>
            <input type="number" min="1" value={adults} onChange={(e) => setAdults(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Children</label>
            <input type="number" min="0" value={children} onChange={(e) => setChildren(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Channel</label>
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="direct">Direct</option>
              <option value="booking.com">Booking.com</option>
              <option value="expedia">Expedia</option>
              <option value="airbnb">Airbnb</option>
              <option value="extranet">Extranet</option>
            </select>
          </div>
        </div>

        {quote && (
          <div style={{ marginTop: 12, background: 'var(--accent-soft)', borderRadius: 8, padding: 12, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{quote.nights} night{quote.nights > 1 ? 's' : ''} accommodation</span><strong>£{quote.baseTotal.toFixed(2)}</strong>
            </div>
            {quote.directDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--green)' }}>
                <span>Direct booking (−{quote.directPct}%)</span><strong>−£{quote.directDiscount.toFixed(2)}</strong>
              </div>
            )}
            {quote.losDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--green)' }}>
                <span>Length-of-stay discount (−{quote.losPct}%)</span><strong>−£{quote.losDiscount.toFixed(2)}</strong>
              </div>
            )}
            {quote.guestFees > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Extra guests</span><strong>£{quote.guestFees.toFixed(2)}</strong>
              </div>
            )}
            {quote.promoCode && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--green)' }}>
                <span>Promo “{quote.promoCode}”</span><strong>−£{quote.promoDiscount.toFixed(2)}</strong>
              </div>
            )}
            {quote.promoValid === false && (
              <div style={{ color: 'var(--red)' }}>⚠ promo code not recognised</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6, fontSize: 15 }}>
              <span>Quote total</span><strong>£{quote.totalPrice.toFixed(2)}</strong>
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              {quote.available > 0 ? `${quote.available} available` : '⚠ NOT available for these dates'}
              {' · '}£{(quote.totalPrice / quote.nights).toFixed(2)}/night effective
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 2 }}>
            <label>Guest name (required to book)</label>
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="leave empty if just quoting" />
          </div>
          <div style={{ flex: 1 }}>
            <label>Promo code</label>
            <input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="e.g. extend" />
          </div>
          <div style={{ flex: 1 }}>
            <label>Override total £</label>
            <input type="number" step="0.01" value={priceOverride} onChange={(e) => setPriceOverride(e.target.value)} placeholder={quote ? quote.totalPrice.toFixed(2) : ''} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <label>Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={sendLink} onChange={(e) => setSendLink(e.target.checked)} />
          Email Stripe payment link to the guest (needs email)
        </label>
        <div className="row">
          <button disabled={pending || !valid || !guestName.trim() || (sendLink && !email.trim())} onClick={create}>
            {pending ? 'Creating…' : 'Create confirmed booking'}
          </button>
          <button className="secondary" onClick={onClose}>Close (quote only)</button>
        </div>
      </div>
    </div>
  );
}

function PropertyRows({
  group: g,
  propBookings,
  untyped,
  dates,
  rates,
  renderCells,
}: {
  group: Group;
  propBookings: B[];
  untyped: B[];
  dates: string[];
  rates: Record<number, Record<string, number>>;
  renderCells: (occ: (date: string) => B[], rowTarget: RowTarget, allowOverlapWarn: boolean, conflictOcc?: (date: string) => B[]) => React.ReactNode;
}) {
  return (
    <>
      <tr className="mc-prop">
        <td colSpan={dates.length + 1}>{g.name}</td>
      </tr>
      {g.types.map((t) => {
        const typeBookings = propBookings.filter((b) => b.roomTypeId === t.id);
        const unassigned = typeBookings.filter((b) => !b.physicalRoom);
        return (
          <TypeRows key={t.id} g={g} t={t} typeBookings={typeBookings} unassigned={unassigned} dates={dates} rates={rates} renderCells={renderCells} />
        );
      })}
      {(untyped.length > 0) && (
        <tr>
          <td className="room-name mc-unassigned">⚠ No room type ({untyped.length})</td>
          {renderCells(
            (date) => untyped.filter((b) => b.checkIn <= date && date < b.checkOut),
            { propertyId: g.id, physicalRoom: null, roomTypeId: null },
            false
          )}
        </tr>
      )}
    </>
  );
}

function TypeRows({
  g,
  t,
  typeBookings,
  unassigned,
  dates,
  rates,
  renderCells,
}: {
  g: Group;
  t: { id: number; name: string; basePrice: number; rooms: string[] };
  typeBookings: B[];
  unassigned: B[];
  dates: string[];
  rates: Record<number, Record<string, number>>;
  renderCells: (occ: (date: string) => B[], rowTarget: RowTarget, allowOverlapWarn: boolean, conflictOcc?: (date: string) => B[]) => React.ReactNode;
}) {
  return (
    <>
      <tr className="mc-type">
        <td>{t.name}</td>
        {dates.map((d) => (
          <td key={d} className="mc-rate">£{rates[t.id]?.[d] ?? t.basePrice}</td>
        ))}
      </tr>
      {t.rooms.flatMap((room) => {
        const roomBookings = typeBookings.filter((b) => b.physicalRoom === room);
        const fullRoomOcc = (date: string) =>
          roomBookings.filter((b) => b.checkIn <= date && date < b.checkOut);
        const lanes = assignLanes(roomBookings);
        return lanes.map((laneBookings, laneIdx) => (
          <tr key={`${room}-${laneIdx}`} className={laneIdx > 0 ? 'mc-lane' : undefined}>
            <td className={laneIdx === 0 ? 'room-name' : 'room-name mc-lane-label'}>
              {laneIdx === 0 ? `Room ${room}` : ''}
            </td>
            {renderCells(
              (date) => laneBookings.filter((b) => b.checkIn <= date && date < b.checkOut),
              { propertyId: g.id, physicalRoom: room, roomTypeId: t.id },
              true,
              fullRoomOcc
            )}
          </tr>
        ));
      })}
      {unassigned.length > 0 && (
        <tr>
          <td className="room-name mc-unassigned">⚠ Unassigned ({unassigned.length})</td>
          {renderCells(
            (date) => unassigned.filter((b) => b.checkIn <= date && date < b.checkOut),
            { propertyId: g.id, physicalRoom: null, roomTypeId: t.id },
            false
          )}
        </tr>
      )}
    </>
  );
}
