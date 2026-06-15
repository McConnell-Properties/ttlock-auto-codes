'use client';

import { useEffect, useState } from 'react';

const WHATSAPP = '+447491295270';

const LUGGAGE_TIMES = Array.from({ length: 26 }, (_, i) => {
  const h = Math.floor(i / 2) + 7;
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
}); // 07:00 → 19:30

type Props = { checkInDate: string; checkOutDate: string };

function computeEarlyPrice(tier: '1pm' | '2pm', pastDeadline: boolean) {
  if (tier === '1pm') return pastDeadline ? 15 : 10;
  return pastDeadline ? 10 : 5;
}

function earlyDeadline(checkInDate: string): Date {
  // 20:00 UK time the day before check-in — approximate as UTC offset detection is client-side.
  const prev = new Date(checkInDate + 'T00:00:00Z');
  prev.setUTCDate(prev.getUTCDate() - 1);
  // Build 20:00 in Europe/London for that day; approximate with Intl.
  // We create the target as 20:00 local UK time.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const prevStr = prev.toISOString().slice(0, 10); // YYYY-MM-DD
  // Construct "YYYY-MM-DD 20:00:00 UK" by finding offset at that time.
  // Use a close approximation: try 20:00 UTC, adjust by current UK offset.
  const probe = new Date(`${prevStr}T20:00:00Z`);
  const parts = fmt.formatToParts(probe);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const ukHour = Number(g('hour'));
  // If the probe shows 21:00 UK, the offset is +1 (BST), so 20:00 UK = 19:00 UTC.
  const offsetHours = ukHour - 20; // e.g. +1 in BST
  probe.setUTCHours(20 - offsetHours, 0, 0, 0);
  return probe;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sc}s`;
  return `${sc}s`;
}

export default function CheckinContactForm({ checkInDate, checkOutDate }: Props) {
  const [phone, setPhone] = useState(false);
  const [email, setEmail] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [earlyCheckin, setEarlyCheckin] = useState<'' | '1pm' | '2pm'>('');
  const [parking, setParking] = useState(false);
  const [luggage, setLuggage] = useState(false);
  const [luggageDate, setLuggageDate] = useState('');
  const [luggageNights, setLuggageNights] = useState(1);
  const [luggageTime, setLuggageTime] = useState('09:00');
  const [msLeft, setMsLeft] = useState(0);

  const deadline = earlyDeadline(checkInDate);
  const pastDeadline = Date.now() >= deadline.getTime();

  useEffect(() => {
    const update = () => setMsLeft(Math.max(0, deadline.getTime() - Date.now()));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkInDate]);

  const countdown = fmtCountdown(msLeft);
  const atLeastOne = phone || email || whatsapp;

  return (
    <form action="/api/checkin/contact" method="post">

      {/* ── Contact methods ─────────────────────────────────── */}
      <p style={{ fontWeight: 600, marginBottom: 10, marginTop: 0 }}>
        How should we reach you? <span style={{ color: 'var(--danger)' }}>*</span>
      </p>
      <p className="fine" style={{ marginBottom: 14 }}>Select at least one — we'll use these if anything comes up.</p>

      {/* Phone */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
        <input type="checkbox" name="contact_phone" value="1"
          checked={phone} onChange={(e) => setPhone(e.target.checked)}
          style={{ marginTop: 3 }} />
        <span style={{ fontWeight: 500 }}>Phone</span>
      </label>
      {phone && (
        <div className="field" style={{ marginLeft: 28, marginBottom: 14 }}>
          <input name="contact_phone_value" type="tel" required={phone}
            placeholder="+44 7700 900000" autoComplete="tel" />
        </div>
      )}

      {/* WhatsApp */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
        <input type="checkbox" name="contact_whatsapp" value="1"
          checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)}
          style={{ marginTop: 3 }} />
        <span style={{ fontWeight: 500 }}>WhatsApp</span>
        <span className="fine" style={{ marginTop: 2 }}>(we'll message you on {WHATSAPP})</span>
      </label>
      {whatsapp && (
        <div className="field" style={{ marginLeft: 28, marginBottom: 14 }}>
          <input name="contact_whatsapp_value" type="tel" required={whatsapp}
            placeholder="+44 7700 900000" autoComplete="tel" />
        </div>
      )}

      {/* Email */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
        <input type="checkbox" name="contact_email" value="1"
          checked={email} onChange={(e) => setEmail(e.target.checked)}
          style={{ marginTop: 3 }} />
        <span style={{ fontWeight: 500 }}>Email</span>
      </label>
      {email && (
        <div className="field" style={{ marginLeft: 28, marginBottom: 14 }}>
          <input name="contact_email_value" type="email" required={email}
            placeholder="you@example.com" autoComplete="email" />
        </div>
      )}

      <hr style={{ margin: '20px 0', borderColor: '#eee' }} />

      {/* ── Early check-in offers ────────────────────────────── */}
      <p style={{ fontWeight: 600, marginBottom: 8 }}>Early check-in (optional)</p>
      {!pastDeadline && countdown && (
        <p className="fine" style={{ marginBottom: 12 }}>
          Early-bird prices end in <strong>{countdown}</strong> — then 1pm rises to £15, 2pm to £10.
        </p>
      )}
      {pastDeadline && (
        <p className="fine" style={{ marginBottom: 12 }}>Standard pricing applies.</p>
      )}

      {/* No early check-in */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
        <input type="radio" name="earlyCheckin" value=""
          checked={earlyCheckin === ''} onChange={() => setEarlyCheckin('')} />
        <span>No early check-in — I'll arrive from 3pm</span>
      </label>

      {/* 1pm offer */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, cursor: 'pointer' }}>
        <input type="radio" name="earlyCheckin" value="1pm"
          checked={earlyCheckin === '1pm'} onChange={() => setEarlyCheckin('1pm')} />
        <span>
          <strong>1pm check-in — £{computeEarlyPrice('1pm', pastDeadline)}</strong>
          {!pastDeadline && (
            <span className="fine"> (rises to £15 in {countdown})</span>
          )}
        </span>
      </label>

      {/* 2pm offer */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
        <input type="radio" name="earlyCheckin" value="2pm"
          checked={earlyCheckin === '2pm'} onChange={() => setEarlyCheckin('2pm')} />
        <span>
          <strong>2pm check-in — £{computeEarlyPrice('2pm', pastDeadline)}</strong>
          {!pastDeadline && (
            <span className="fine"> (rises to £10 in {countdown})</span>
          )}
        </span>
      </label>

      <hr style={{ margin: '20px 0', borderColor: '#eee' }} />

      {/* ── Parking ─────────────────────────────────────────── */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 20, cursor: 'pointer' }}>
        <input type="checkbox" name="parking" value="1"
          checked={parking} onChange={(e) => setParking(e.target.checked)}
          style={{ marginTop: 3 }} />
        <span>
          <span style={{ fontWeight: 500 }}>I need parking</span>
          <span className="fine" style={{ display: 'block', marginTop: 2 }}>
            Offsite reserved space — from £6/night + £5 per use. Select exact dates on the next screen.
          </span>
        </span>
      </label>

      <hr style={{ margin: '20px 0', borderColor: '#eee' }} />

      {/* ── Luggage drop-off ────────────────────────────────── */}
      <p style={{ fontWeight: 600, marginBottom: 8 }}>Luggage drop-off (optional)</p>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
        <input type="checkbox" name="luggage" value="1"
          checked={luggage} onChange={(e) => setLuggage(e.target.checked)}
          style={{ marginTop: 3 }} />
        <span>
          <span style={{ fontWeight: 500 }}>I need luggage storage — £5/night</span>
          <span className="fine" style={{ display: 'block', marginTop: 2 }}>
            Store your bags before check-in or after check-out.
          </span>
        </span>
      </label>
      {luggage && (
        <div style={{ marginLeft: 28, marginBottom: 14 }}>
          <div className="form-grid" style={{ marginBottom: 8 }}>
            <div className="field">
              <label>Drop-off date</label>
              <input type="date" name="luggageDate" required={luggage}
                min={checkInDate} max={checkOutDate}
                value={luggageDate} onChange={(e) => setLuggageDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Nights</label>
              <select name="luggageNights" value={luggageNights}
                onChange={(e) => setLuggageNights(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} night{n > 1 ? 's' : ''} — £{5 * n}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Drop-off time</label>
              <select name="luggageTime" value={luggageTime}
                onChange={(e) => setLuggageTime(e.target.value)}>
                {LUGGAGE_TIMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <button
        className="btn"
        type="submit"
        disabled={!atLeastOne}
        style={{ width: '100%', opacity: atLeastOne ? 1 : 0.5 }}
      >
        Continue →
      </button>
      {!atLeastOne && (
        <p className="fine" style={{ textAlign: 'center', marginTop: 8, color: 'var(--danger)' }}>
          Please select at least one contact method.
        </p>
      )}
    </form>
  );
}
