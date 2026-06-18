'use client';

import { useState } from 'react';

type Row = { extraId: string; label: string; capacity: number; fromTurso: boolean };

export default function CapacityEditor({ rows }: { rows: Row[] }) {
  const [items, setItems] = useState(rows.map((r) => ({ ...r, draft: r.capacity, saving: false, saved: false, error: '' })));

  async function save(extraId: string) {
    setItems((prev) => prev.map((i) => i.extraId === extraId ? { ...i, saving: true, error: '' } : i));
    const item = items.find((i) => i.extraId === extraId)!;
    const res = await fetch('/api/extras/capacity', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extraId, capacity: item.draft }),
    });
    if (res.ok) {
      setItems((prev) => prev.map((i) => i.extraId === extraId ? { ...i, capacity: item.draft, saving: false, saved: true } : i));
      setTimeout(() => setItems((prev) => prev.map((i) => i.extraId === extraId ? { ...i, saved: false } : i)), 2000);
    } else {
      const { error } = await res.json().catch(() => ({ error: 'Save failed' }));
      setItems((prev) => prev.map((i) => i.extraId === extraId ? { ...i, saving: false, error } : i));
    }
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Extra</th>
          <th>ID</th>
          <th style={{ textAlign: 'right' }}>Capacity</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.extraId}>
            <td>{item.label}</td>
            <td><code>{item.extraId}</code></td>
            <td style={{ textAlign: 'right', width: 120 }}>
              <input
                type="number"
                min={1}
                step={1}
                value={item.draft}
                style={{ width: 70, textAlign: 'right' }}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setItems((prev) => prev.map((i) => i.extraId === item.extraId ? { ...i, draft: v } : i));
                }}
              />
            </td>
            <td style={{ paddingLeft: 12 }}>
              {item.draft !== item.capacity && !item.saving && (
                <button className="btn" onClick={() => save(item.extraId)} disabled={item.draft < 1}>
                  Save
                </button>
              )}
              {item.saving && <span className="muted">Saving…</span>}
              {item.saved && <span style={{ color: 'green' }}>Saved</span>}
              {item.error && <span style={{ color: 'red' }}>{item.error}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
