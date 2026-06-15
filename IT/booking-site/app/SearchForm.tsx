'use client';
import { useState } from 'react';

function plusDays(base: string, n: number) {
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function SearchForm(props: {
  checkIn?: string; checkOut?: string; guests?: number; prefer?: string; minBeds?: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [checkIn, setCheckIn] = useState(props.checkIn || plusDays(today, 1));
  const [checkOut, setCheckOut] = useState(props.checkOut || plusDays(today, 3));
  const [error, setError] = useState('');

  function validate(e: React.FormEvent) {
    if (checkOut <= checkIn) {
      e.preventDefault();
      setError('Check-out must be after check-in.');
      return;
    }
    if (checkIn < today) {
      e.preventDefault();
      setError('Check-in cannot be in the past.');
      return;
    }
    setError('');
  }

  return (
    <form className="search-card" action="/search" method="get" onSubmit={validate}>
      <div className="field">
        <label htmlFor="checkIn">Check-in</label>
        <input id="checkIn" type="date" name="checkIn" required min={today} value={checkIn}
          onChange={(e) => {
            setCheckIn(e.target.value);
            if (checkOut <= e.target.value) setCheckOut(plusDays(e.target.value, 1));
          }} />
      </div>
      <div className="field">
        <label htmlFor="checkOut">Check-out</label>
        <input id="checkOut" type="date" name="checkOut" required min={plusDays(checkIn, 1)}
          value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="guests">Guests</label>
        <select id="guests" name="guests" defaultValue={String(props.guests || 1)}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'guest' : 'guests'}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="prefer">Room preference</label>
        <select id="prefer" name="prefer" defaultValue={props.prefer || 'bathroom'}>
          <option value="bathroom">Private bathroom</option>
          <option value="kitchen">Private kitchen</option>
          <option value="none">No preference</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="minBeds">Separate beds</label>
        <select id="minBeds" name="minBeds" defaultValue={String(props.minBeds || 1)}>
          <option value="1">Any</option>
          <option value="2">2+ beds</option>
          <option value="3">3+ beds</option>
        </select>
      </div>
      <button className="btn" type="submit">Search availability</button>
      {error && <p style={{ color: 'var(--danger)', gridColumn: '1 / -1', margin: 0 }}>{error}</p>}
    </form>
  );
}
