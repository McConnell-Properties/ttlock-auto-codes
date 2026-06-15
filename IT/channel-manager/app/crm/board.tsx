'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateCrmAction, updateExtrasAction, sendGuestEmailAction } from '@/lib/actions';

type Row = {
  id: number;
  guestName: string;
  email: string | null;
  phone: string | null;
  checkIn: string;
  checkOut: string;
  propertyName: string;
  roomTypeName: string | null;
  physicalRoom: string | null;
  channel: string;
  channelRef: string | null;
  notes: string | null;
  preStayCall?: string | null; preStayDate?: string | null;
  formSent?: string | null; formCompleted?: string | null;
  midStayCall?: string | null; msDate?: string | null;
  checkinRating?: number | null; cleanlinessRating?: number | null;
  issueFlagged?: string | null; taskGiven?: string | null;
  firstContact?: string | null; fcDate?: string | null; feedback?: string | null;
  rebookingInterest?: string | null; directBookingOffered?: string | null; promoCodeGiven?: string | null;
  secondContact?: string | null; scDate?: string | null;
  review?: string | null; reviewDate?: string | null; reviewScore?: number | null;
  guestSentiment?: string | null;
  arrivalTime?: string | null;
  contactMethod?: string | null;
  contactValue?: string | null;
  cardSaved?: string | null;
  preArrivalCompletedAt?: string | null;
  confirmedAt?: string | null;
  preArrivalNotes?: string | null;
  arrivedDetected?: string | null;
  arrivedAt?: string | null;
  arrivedSource?: string | null;
};

const CALL = ['', 'done', 'no_answer', 'not_reachable', 'message_sent', 'na'];
const CALL_LABEL: Record<string, string> = {
  '': '— to do —', done: '✓ done', no_answer: 'no answer', not_reachable: 'not reachable',
  message_sent: 'message sent', na: 'n/a',
};
const YN = ['', 'yes', 'no', 'na'];
const REBOOK = ['', 'yes', 'maybe', 'no'];
const REVIEW = ['', 'received', 'chased', 'declined'];
const SENTIMENT = ['', 'positive', 'neutral', 'negative'];
const SENTIMENT_LABEL: Record<string, string> = {
  '': '— sentiment —', positive: '🙂 positive', neutral: '😐 neutral', negative: '🙁 negative',
};
const EXTRA_STATUS = ['pending', 'in_progress', 'done', 'cancelled'];

type ExtraTask = {
  id: number;
  bookingReference: string;
  bookingId: number | null;
  extra: string;
  date: string | null;
  time: string | null;
  nights: number | null;
  price: number | null;
  taskStatus: string;
  guestName: string | null;
  propertyName: string | null;
  physicalRoom: string | null;
  checkIn: string | null;
};

function addDays(d: string, n: number) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

const open = (v?: string | null) => !v || v === 'no_answer' || v === 'not_reachable' || v === 'message_sent';

export default function CrmBoard({ rows, extras, today }: { rows: Row[]; extras: ExtraTask[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const save = (bookingId: number, fields: Record<string, unknown>) =>
    startTransition(async () => {
      await updateCrmAction(bookingId, fields);
      router.refresh();
    });

  const saveExtra = (id: number, taskStatus: string) =>
    startTransition(async () => {
      await updateExtrasAction(id, taskStatus);
      router.refresh();
    });

  const STAGE_LABEL: Record<string, string> = {
    pre: 'pre-arrival (door code)', mid: 'day-after check-in', post: 'thank-you + feedback', chase: 'review request',
  };
  const sendEmail = (r: Row, stage: 'pre' | 'mid' | 'post' | 'chase') => {
    if (!r.email) { alert(`${r.guestName} has no email on the booking — add one first.`); return; }
    if (!confirm(`Send the ${STAGE_LABEL[stage]} email to ${r.guestName} <${r.email}>?`)) return;
    startTransition(async () => {
      const res = await sendGuestEmailAction(r.id, stage);
      if (!res.ok) alert(`Couldn't send: ${res.error}`);
      else if (stage === 'pre' && !res.lockCode) alert('Sent — but no door code was found for this booking ref, so the email says the code will follow separately.');
      router.refresh();
    });
  };

  const EmailBtn = ({ r, stage }: { r: Row; stage: 'pre' | 'mid' | 'post' | 'chase' }) => (
    <button
      type="button"
      disabled={pending}
      title={r.email ? `Email ${STAGE_LABEL[stage]} to ${r.email}` : 'No guest email on the booking'}
      style={{ padding: '4px 8px', fontSize: 12.5, opacity: r.email ? 1 : 0.4, cursor: r.email ? 'pointer' : 'not-allowed' }}
      onClick={() => sendEmail(r, stage)}
    >
      ✉ send
    </button>
  );

  // Stage membership (tasks persist until done/na — "outstanding" = due date already passed)
  const preStay = rows.filter((r) => open(r.preStayCall) && r.checkIn > today && r.checkIn <= addDays(today, 2));
  const inStay = rows.filter((r) => open(r.midStayCall) && r.checkIn < today && r.checkOut > today);
  const postStay = rows.filter((r) => open(r.firstContact) && r.checkOut <= today);
  const reviewChase = rows.filter(
    (r) => r.firstContact === 'done' && open(r.secondContact) && !['received', 'declined'].includes(r.review || '') && r.checkOut <= today
  );

  const Select = ({
    r, field, options, labels, value,
  }: { r: Row; field: string; options: string[]; labels?: Record<string, string>; value?: string | null }) => (
    <select
      value={value ?? ''}
      disabled={pending}
      style={{ width: 'auto', padding: '4px 6px', fontSize: 12.5 }}
      onChange={(e) => save(r.id, { [field]: e.target.value })}
    >
      {options.map((o) => <option key={o} value={o}>{labels ? labels[o] ?? o : (o === '' ? '—' : o)}</option>)}
    </select>
  );

  const NumInput = ({ r, field, value }: { r: Row; field: string; value?: number | null }) => (
    <input
      type="number" min={1} max={10} defaultValue={value ?? ''} disabled={pending}
      style={{ width: 52, padding: '4px 6px', fontSize: 12.5 }}
      onBlur={(e) => { const v = e.target.value; if (v !== String(value ?? '')) save(r.id, { [field]: v === '' ? null : Number(v) }); }}
    />
  );

  const TextInput = ({ r, field, value, w = 140, ph }: { r: Row; field: string; value?: string | null; w?: number; ph?: string }) => (
    <input
      defaultValue={value ?? ''} placeholder={ph} disabled={pending}
      style={{ width: w, padding: '4px 6px', fontSize: 12.5 }}
      onBlur={(e) => { const v = e.target.value; if (v !== (value ?? '')) save(r.id, { [field]: v || null }); }}
    />
  );

  const Guest = ({ r }: { r: Row }) => (
    <td style={{ minWidth: 190 }}>
      <strong>{r.guestName}</strong>
      {r.guestSentiment === 'positive' && <span title="positive guest"> 🙂</span>}
      {r.guestSentiment === 'negative' && <span title="negative guest"> 🙁</span>}
      <div className="muted" style={{ fontSize: 11.5 }}>
        {r.propertyName}{r.physicalRoom ? ` · Rm ${r.physicalRoom}` : ''} · {r.checkIn} → {r.checkOut}
      </div>
      <div className="muted" style={{ fontSize: 11.5 }}>
        {r.phone || 'no phone'}{r.email ? ` · ${r.email.slice(0, 28)}` : ''}
      </div>
      <div style={{ fontSize: 11, marginTop: 3 }}>
        {r.preArrivalCompletedAt
          ? <span style={{ color: 'var(--green, #2a7a2a)', fontWeight: 600 }}>✓ pre-arrival {r.preArrivalCompletedAt.slice(0, 10)}</span>
          : <span className="muted">⏳ awaiting pre-arrival</span>}
        {r.arrivalTime && <span className="muted"> · arrives {r.arrivalTime}</span>}
        {r.contactMethod && r.contactValue && <span className="muted"> · {r.contactMethod}: {r.contactValue}</span>}
        {r.cardSaved === 'yes' && <span className="muted"> · 💳 card saved</span>}
        {r.preArrivalNotes && <div className="muted" style={{ fontSize: 10.5 }} title={r.preArrivalNotes}>{r.preArrivalNotes.slice(0, 60)}{r.preArrivalNotes.length > 60 ? '…' : ''}</div>}
      </div>
    </td>
  );

  // Arrived? cell:
  //   auto      → guest code matched → "✓ arrived HH:MM" (confirmed)
  //   auto-weak → non-service unlock, no guest code match → muted "🔓 door opened HH:MM" + tooltip
  //   otherwise → manual select
  const ArrivedCell = ({ r }: { r: Row }) => {
    if (r.arrivedDetected === 'yes' && (r.arrivedSource === 'auto' || r.arrivedSource === 'auto-weak')) {
      const time = r.arrivedAt
        ? new Date(r.arrivedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : '';
      const date = r.arrivedAt ? new Date(r.arrivedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

      if (r.arrivedSource === 'auto') {
        return (
          <td title={`Guest code matched: ${r.arrivedAt ?? ''}`}>
            <span style={{ color: 'var(--green, #2a7a2a)', fontWeight: 600 }}>✓ arrived</span> {date} {time}
          </td>
        );
      }

      // auto-weak: unattributed (no guest code on file)
      return (
        <td title={`Door opened (guest code unknown — non-service unlock): ${r.arrivedAt ?? ''}`}>
          <span className="muted">🔓 door opened {date} {time}</span>
        </td>
      );
    }
    return (
      <td>
        <select
          value={r.arrivedDetected ?? ''}
          disabled={pending}
          style={{ width: 'auto', padding: '4px 6px', fontSize: 12.5 }}
          onChange={(e) => save(r.id, { arrivedDetected: e.target.value || '', arrivedSource: 'manual' })}
        >
          <option value="">— ?</option>
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      </td>
    );
  };

  const overdue = (due: string) => due < today;

  return (
    <>
      <div className="stat-row">
        <div className="stat"><div className="num">{preStay.length}</div><div className="lbl">Pre-stay calls due</div></div>
        <div className="stat"><div className="num">{inStay.length}</div><div className="lbl">In-stay check-ins</div></div>
        <div className="stat"><div className="num">{postStay.length}</div><div className="lbl">Post-stay contacts</div></div>
        <div className="stat"><div className="num">{reviewChase.length}</div><div className="lbl">Review chases</div></div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>1 · Pre-stay calls <span className="muted">(arriving within 2 days)</span></h2>
        {preStay.length === 0 ? <p className="muted">All clear.</p> : (
          <table>
            <thead><tr><th>Guest</th><th>Arrives</th><th>Call</th><th>Email</th><th>Form sent</th><th>Form completed</th></tr></thead>
            <tbody>
              {preStay.map((r) => (
                <tr key={r.id}>
                  <Guest r={r} />
                  <td>{r.checkIn === addDays(today, 1) ? 'tomorrow' : r.checkIn}</td>
                  <td><Select r={r} field="preStayCall" options={CALL} labels={CALL_LABEL} value={r.preStayCall} /></td>
                  <td><EmailBtn r={r} stage="pre" /></td>
                  <td><Select r={r} field="formSent" options={YN} value={r.formSent} /></td>
                  <td><Select r={r} field="formCompleted" options={YN} value={r.formCompleted} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>2 · In-stay calls <span className="muted">(day after arrival; stays open until done)</span></h2>
        {inStay.length === 0 ? <p className="muted">All clear.</p> : (
          <table>
            <thead><tr><th>Guest</th><th>Arrived?</th><th>Check-in</th><th>Call</th><th>Email</th><th>Sentiment</th><th>Check-in /10</th><th>Cleanliness /10</th><th>Issue flagged</th><th>Task given</th></tr></thead>
            <tbody>
              {inStay.map((r) => (
                <tr
                  key={r.id}
                  style={
                    r.guestSentiment === 'negative' ? { background: 'var(--red-soft)' }
                    : (r.arrivedDetected !== 'yes' || (overdue(addDays(r.checkIn, 1)) && !r.midStayCall)) ? { background: 'var(--amber-soft)' }
                    : undefined
                  }
                >
                  <Guest r={r} />
                  <ArrivedCell r={r} />
                  <td>{r.checkIn}</td>
                  <td><Select r={r} field="midStayCall" options={CALL} labels={CALL_LABEL} value={r.midStayCall} /></td>
                  <td><EmailBtn r={r} stage="mid" /></td>
                  <td><Select r={r} field="guestSentiment" options={SENTIMENT} labels={SENTIMENT_LABEL} value={r.guestSentiment} /></td>
                  <td><NumInput r={r} field="checkinRating" value={r.checkinRating} /></td>
                  <td><NumInput r={r} field="cleanlinessRating" value={r.cleanlinessRating} /></td>
                  <td><TextInput r={r} field="issueFlagged" value={r.issueFlagged} ph="none" /></td>
                  <td><TextInput r={r} field="taskGiven" value={r.taskGiven} ph="e.g. fix shower" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>3 · Post-stay contact <span className="muted">(checked out; feedback + rebooking)</span></h2>
        {postStay.length === 0 ? <p className="muted">All clear.</p> : (
          <table>
            <thead><tr><th>Guest</th><th>Left</th><th>Contact</th><th>Email</th><th>Feedback</th><th>Rebooking?</th><th>Direct offered</th><th>Promo given</th></tr></thead>
            <tbody>
              {postStay.map((r) => (
                <tr key={r.id} style={overdue(addDays(r.checkOut, 2)) ? { background: 'var(--amber-soft)' } : undefined}>
                  <Guest r={r} />
                  <td>{r.checkOut}</td>
                  <td><Select r={r} field="firstContact" options={CALL} labels={CALL_LABEL} value={r.firstContact} /></td>
                  <td><EmailBtn r={r} stage="post" /></td>
                  <td><TextInput r={r} field="feedback" value={r.feedback} w={170} /></td>
                  <td><Select r={r} field="rebookingInterest" options={REBOOK} value={r.rebookingInterest} /></td>
                  <td><Select r={r} field="directBookingOffered" options={YN} value={r.directBookingOffered} /></td>
                  <td><TextInput r={r} field="promoCodeGiven" value={r.promoCodeGiven} w={90} ph="extend" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>4 · Review chase <span className="muted">(contacted, no review yet)</span></h2>
        {reviewChase.length === 0 ? <p className="muted">All clear.</p> : (
          <table>
            <thead><tr><th>Guest</th><th>Left</th><th>Chase</th><th>Email</th><th>Review</th><th>Score</th></tr></thead>
            <tbody>
              {reviewChase.map((r) => (
                <tr key={r.id}>
                  <Guest r={r} />
                  <td>{r.checkOut}</td>
                  <td><Select r={r} field="secondContact" options={CALL} labels={CALL_LABEL} value={r.secondContact} /></td>
                  <td><EmailBtn r={r} stage="chase" /></td>
                  <td><Select r={r} field="review" options={REVIEW} value={r.review} /></td>
                  <td><NumInput r={r} field="reviewScore" value={r.reviewScore} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>5 · Operations — extras <span className="muted">(from booking-site requests; run `node db/import-extras.mjs` to pull new ones)</span></h2>
        {extras.length === 0 ? <p className="muted">No open extras tasks.</p> : (
          <table>
            <thead><tr><th>Booking</th><th>Extra</th><th>When</th><th>Nights</th><th>Price</th><th>Status</th></tr></thead>
            <tbody>
              {extras.map((e) => (
                <tr key={e.id} style={!e.bookingId ? { background: 'var(--amber-soft)' } : undefined}>
                  <td style={{ minWidth: 180 }}>
                    {e.guestName ? <strong>{e.guestName}</strong> : <span style={{ color: 'var(--amber)' }}>⚠ unmatched</span>}
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      <span className="mono">{e.bookingReference}</span>
                      {e.propertyName ? ` · ${e.propertyName}` : ''}{e.physicalRoom ? ` · Rm ${e.physicalRoom}` : ''}
                    </div>
                  </td>
                  <td><strong>{e.extra}</strong></td>
                  <td className="mono">{e.date || e.checkIn || '—'}{e.time ? ` ${e.time}` : ''}</td>
                  <td>{e.nights ?? '—'}</td>
                  <td>{e.price != null ? `£${e.price}` : '—'}</td>
                  <td>
                    <select
                      value={e.taskStatus}
                      disabled={pending}
                      style={{ width: 'auto', padding: '4px 6px', fontSize: 12.5 }}
                      onChange={(ev) => saveExtra(e.id, ev.target.value)}
                    >
                      {EXTRA_STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pending && <div className="mc-saving">Saving…</div>}
    </>
  );
}
