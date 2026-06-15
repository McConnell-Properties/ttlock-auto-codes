'use client';

import { useEffect, useMemo, useState } from 'react';

type LuggageWanted = { date: string; nights: number; time: string } | null;
type CalDay = { date: string; price: number; free: number };
type CalData = { total: number; fee: number; feeLabel: string; tiers: { nights: number; rate: number }[]; days: CalDay[] };

const fmtDay = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function CheckinExtrasBlock({
  earlyCheckin,
  earlyCheckinPrice,
  parkingWanted,
  parkingNote,
  checkIn,
  checkOut,
  luggage,
}: {
  earlyCheckin: '1pm' | '2pm' | null;
  earlyCheckinPrice: number | null;
  parkingWanted: boolean;
  parkingNote: string | null;
  checkIn: string;
  checkOut: string;
  luggage: LuggageWanted;
}) {
  const [cal, setCal] = useState<CalData | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [nights, setNights] = useState(1);

  useEffect(() => {
    if (parkingWanted) {
      fetch('/api/extras-calendar?extra=parking')
        .then((r) => r.json())
        .then(setCal)
        .catch(() => setCal({ total: 0, fee: 0, feeLabel: '', tiers: [], days: [] }));
    }
  }, [parkingWanted]);

  const rangeOk = (s: string, n: number): boolean => {
    if (!cal) return false;
    const idx = cal.days.findIndex((d) => d.date === s);
    if (idx < 0 || idx + n > cal.days.length) return false;
    for (let i = idx; i < idx + n; i++) if (cal.days[i].free < 1) return false;
    return true;
  };

  const discountRate = useMemo(() => {
    if (!cal?.tiers?.length) return 0;
    let r = 0;
    for (const t of cal.tiers) if (nights >= t.nights) r = t.rate;
    return r;
  }, [cal, nights]);

  const parkingTotal = useMemo(() => {
    if (!cal || !start || !rangeOk(start, nights)) return null;
    const idx = cal.days.findIndex((d) => d.date === start);
    let nightly = 0;
    for (let i = idx; i < idx + nights; i++) nightly += cal.days[i].price;
    return Math.round((nightly * (1 - discountRate) + cal.fee) * 100) / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal, start, nights, discountRate]);

  const earlyTotal = earlyCheckinPrice ?? 0;
  const luggageTotal = luggage ? 5 * luggage.nights : 0;
  const parkingReady = !parkingWanted || (start !== null && parkingTotal !== null && rangeOk(start, nights));
  const combinedTotal = (earlyCheckin ? earlyTotal : 0) + (parkingWanted && parkingTotal !== null ? parkingTotal : 0) + luggageTotal;

  return (
    <form action="/api/checkin/extras-checkout" method="post">
      {earlyCheckin && (
        <div style={{ marginBottom: parkingWanted ? 20 : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600 }}>Early check-in at {earlyCheckin}</span>
            <span style={{ fontWeight: 700 }}>£{earlyTotal}</span>
          </div>
          <input type="hidden" name="earlyCheckin" value={earlyCheckin} />
        </div>
      )}

      {parkingWanted && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>Parking</span>
            {parkingTotal !== null
              ? <span style={{ fontWeight: 700 }}>£{parkingTotal.toFixed(2)}</span>
              : <span className="fine">select dates below</span>}
          </div>
          {parkingNote && <p className="fine" style={{ marginBottom: 10 }}>{parkingNote}</p>}
          {!cal ? (
            <p className="fine">Loading availability…</p>
          ) : (
            <>
              <p className="fine" style={{ marginBottom: 6 }}>
                Click your <strong>first night</strong>, then <strong>last night</strong>.
              </p>
              <div className="cal-grid">
                {cal.days.map((d, i) => {
                  const startIdx = start ? cal.days.findIndex((x) => x.date === start) : -1;
                  const selected = startIdx >= 0 && i >= startIdx && i < startIdx + nights;
                  const sold = d.free < 1;
                  return (
                    <button
                      key={d.date}
                      type="button"
                      disabled={sold}
                      className={`cal-day${sold ? ' sold' : ''}${selected ? ' selected' : ''}${d.date === start ? ' start' : ''}`}
                      onClick={() => {
                        const si = start ? cal.days.findIndex((x) => x.date === start) : -1;
                        if (si < 0 || d.date < start! || nights > 1) {
                          setStart(d.date); setNights(1);
                        } else {
                          setNights(i - si + 1);
                        }
                      }}
                    >
                      <span className="cal-date">{fmtDay(d.date)}</span>
                      <span className="cal-price">£{d.price}</span>
                      <span className="cal-free">{sold ? 'Sold out' : `${d.free}/${cal.total} left`}</span>
                    </button>
                  );
                })}
              </div>
              <input type="hidden" name="parkingDate" value={start || ''} />
              <input type="hidden" name="parkingNights" value={nights} />
              {start && (
                <div style={{ marginTop: 8 }}>
                  <span className="fine">
                    {nights} night{nights > 1 ? 's' : ''} from {fmtDay(start)}
                    {!rangeOk(start, nights) && (
                      <span style={{ color: 'var(--danger)' }}> — some dates sold out, try a different range</span>
                    )}
                  </span>
                </div>
              )}
              {discountRate > 0 && (
                <p className="save" style={{ margin: '6px 0 0' }}>
                  {Math.round(discountRate * 100)}% long-stay discount applied.
                </p>
              )}
              <p className="fine" style={{ marginTop: 4 }}>+ £{cal.fee} {cal.feeLabel} (added once)</p>
            </>
          )}
        </div>
      )}

      {luggage && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #eee' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>
              Luggage drop-off — {luggage.nights} night{luggage.nights > 1 ? 's' : ''}
            </span>
            <span style={{ fontWeight: 700 }}>£{luggageTotal.toFixed(2)}</span>
          </div>
          <p className="fine" style={{ margin: 0 }}>
            Drop-off {fmtDay(luggage.date)} at {luggage.time}
          </p>
          <input type="hidden" name="luggageDate" value={luggage.date} />
          <input type="hidden" name="luggageNights" value={luggage.nights} />
          <input type="hidden" name="luggageTime" value={luggage.time} />
        </div>
      )}

      <div style={{ borderTop: '1px solid #eee', marginTop: 16, paddingTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontWeight: 700, fontSize: '1.05rem' }}>
          <span>Total</span>
          <span>£{combinedTotal.toFixed(2)}</span>
        </div>
        <button
          className="btn"
          type="submit"
          disabled={!parkingReady}
          style={{ width: '100%', opacity: parkingReady ? 1 : 0.5 }}
        >
          Pay £{combinedTotal.toFixed(2)} →
        </button>
        {parkingWanted && !start && (
          <p className="fine" style={{ textAlign: 'center', marginTop: 8 }}>
            Select parking dates above to continue.
          </p>
        )}
      </div>
    </form>
  );
}
