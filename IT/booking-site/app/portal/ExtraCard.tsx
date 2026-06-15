'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Extra } from '@/lib/extras';

const NIGHT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 10, 14];
const CUTOFF_IDS = ['towel-exchange', 'laundry', 'room-clean', 'luggage', 'early-checkin', 'late-checkout'];

type CalDay = { date: string; price: number; free: number; weather?: string };
type CalData = { total: number; fee: number; feeLabel: string; tiers: { nights: number; rate: number }[]; days: CalDay[] };

const fmtDay = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function ExtraCard(props: {
  extra: Extra;
  checkIn: string;
  checkOut: string;
  timeSlots: string[];
  earlyTimes: string[];
  lateTimes: { value: string; label: string }[];
  justRequested: boolean;
  payNow: boolean;
}) {
  const { extra } = props;
  const [open, setOpen] = useState(false);
  const [nights, setNights] = useState(1);
  const [lateTime, setLateTime] = useState('12:00');
  const [cal, setCal] = useState<CalData | null>(null);
  const [start, setStart] = useState<string | null>(null);

  // 11am cutoff: same-day services can't be booked for today after 11am UK time
  const todayCutoff = CUTOFF_IDS.includes(extra.id);
  const minDate = useMemo(() => {
    const now = new Date();
    const ukHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(now));
    const d = new Date(now);
    if (todayCutoff && ukHour >= 11) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [todayCutoff]);

  useEffect(() => {
    if (open && extra.calendar && !cal) {
      fetch(`/api/extras-calendar?extra=${extra.id}`)
        .then((r) => r.json())
        .then(setCal)
        .catch(() => setCal({ total: 0, fee: 0, feeLabel: '', tiers: [], days: [] }));
    }
  }, [open, extra.calendar, extra.id, cal]);

  // calendar selection: range [start, start+nights) must be free every night
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

  const calTotal = useMemo(() => {
    if (!cal || !start) return null;
    const idx = cal.days.findIndex((d) => d.date === start);
    if (idx < 0 || !rangeOk(start, nights)) return null;
    let nightly = 0;
    for (let i = idx; i < idx + nights; i++) nightly += cal.days[i].price;
    return Math.round((nightly * (1 - discountRate) + cal.fee) * 100) / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal, start, nights, discountRate]);

  const simplePrice = (() => {
    switch (extra.id) {
      case 'towel-exchange': return 0;
      case 'early-checkin': case 'laundry': case 'room-clean': return 10;
      case 'late-checkout': return lateTime === '13:00' ? 20 : 10;
      case 'luggage': return 5 * nights;
      default: return 0;
    }
  })();

  return (
    <article className={`extra-card${props.justRequested ? ' requested' : ''}`}>
      <div className="extra-head">
        <h3>{extra.name}</h3>
        <span className={`badge ${extra.tag === 'FREE' ? 'match' : 'scarce'}`}>{extra.tag}</span>
      </div>
      <p className="extra-blurb">{extra.blurb}</p>
      {extra.refundable && <span className="badge match" style={{ alignSelf: 'start' }}>100% refundable</span>}
      {extra.details.length > 0 && (
        <ul className="extra-details">{extra.details.map((d) => <li key={d}>{d}</li>)}</ul>
      )}
      {todayCutoff && (
        <p className="fine">Same-day service: book &amp; pay before 11am to have it done that day.</p>
      )}

      {props.justRequested ? (
        <p className="extra-confirmed">✓ Confirmed — it&apos;s in our task list.</p>
      ) : !open ? (
        <button className="btn secondary" onClick={() => setOpen(true)}>{extra.cta}</button>
      ) : (
        <form className="extra-form" action="/api/extras" method="post">
          <input type="hidden" name="extraId" value={extra.id} />

          {/* ---- calendar extras (aircon, parking) ---- */}
          {extra.calendar && !cal && <p className="fine">Loading availability…</p>}
          {extra.calendar && cal && (
            <>
              <p className="fine" style={{ margin: 0 }}>
                Click your <strong>first night</strong>, then your <strong>last night</strong> to select the days you need.
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
                      title={d.weather}
                      disabled={sold}
                      className={`cal-day${sold ? ' sold' : ''}${selected ? ' selected' : ''}${d.date === start ? ' start' : ''}`}
                      onClick={() => {
                        const startIdx2 = start ? cal.days.findIndex((x) => x.date === start) : -1;
                        if (startIdx2 < 0 || d.date < start! || nights > 1) {
                          // no selection yet, clicked before start, or re-starting a selection
                          setStart(d.date);
                          setNights(1);
                        } else {
                          // second click = last night (inclusive)
                          setNights(i - startIdx2 + 1);
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
              <input type="hidden" name="date" value={start || ''} />
              <input type="hidden" name="nights" value={nights} />
              {start && (
                <div className="plan-row" style={{ marginTop: 0 }}>
                  <span className="fine">
                    {nights} night{nights > 1 ? 's' : ''} from {fmtDay(start)}
                    {!rangeOk(start, nights) && <span style={{ color: 'var(--danger)' }}> — some of those days are sold out, pick a different range</span>}
                  </span>
                  <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                    onClick={() => { setStart(null); setNights(1); }}>
                    Clear selection
                  </button>
                </div>
              )}
              {discountRate > 0 && (
                <p className="save" style={{ margin: 0 }}>
                  {Math.round(discountRate * 100)}% long-stay discount applied — same as our rooms.
                </p>
              )}
              <p className="fine">+ £{cal.fee} {cal.feeLabel} (added once per booking)</p>
            </>
          )}

          {/* ---- simple extras ---- */}
          {!extra.calendar && extra.fields.includes('date') && (
            <div className="field">
              <label>Date</label>
              <input type="date" name="date" required min={minDate > props.checkIn ? minDate : props.checkIn} max={props.checkOut}
                defaultValue={minDate > props.checkIn ? minDate : props.checkIn} />
            </div>
          )}
          {!extra.calendar && extra.fields.includes('nights') && (
            <div className="field">
              <label>Nights</label>
              <select name="nights" value={nights} onChange={(e) => setNights(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
          {!extra.calendar && extra.fields.includes('time') && (
            <div className="field">
              <label>{extra.id === 'luggage' ? 'Arrival time' : 'Time'}</label>
              <select name="time" defaultValue="12:00">
                {props.timeSlots.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          {extra.fields.includes('earlyTime') && (
            <div className="field">
              <label>Arrival time</label>
              <select name="earlyTime" defaultValue="13:00">
                {props.earlyTimes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          {extra.fields.includes('lateTime') && (
            <div className="field">
              <label>Check-out time</label>
              <select name="lateTime" value={lateTime} onChange={(e) => setLateTime(e.target.value)}>
                {props.lateTimes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          )}

          <div className="extra-actions">
            <span className="extra-total">
              {extra.calendar
                ? calTotal !== null ? `Total: £${calTotal.toFixed(2)}` : 'Pick a start date'
                : simplePrice === 0 ? 'Free' : `Total: £${simplePrice.toFixed(2)}`}
            </span>
            <button className="btn" type="submit" disabled={extra.calendar && calTotal === null}>
              {extra.calendar
                ? calTotal !== null ? (props.payNow ? `Pay £${calTotal.toFixed(2)}` : 'Book (pay on arrival)') : 'Select dates'
                : simplePrice === 0 ? 'Send request' : props.payNow ? `Pay £${simplePrice.toFixed(2)}` : 'Book (pay on arrival)'}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
