'use client';

import { useTransition } from 'react';
import { updateExtraAction } from '@/lib/actions';
import { useRouter } from 'next/navigation';

type ExtraRow = {
  id: number;
  extra: string;
  date: string | null;
  time: string | null;
  nights: number | null;
  price: number | null;
  billing: string;
  addedBy: string;
  taskStatus: string;
  guestName: string | null;
  propertyName: string | null;
  physicalRoom: string | null;
};

export default function TasksDayView({ extras }: { extras: ExtraRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggleStatus = (id: number, current: string) => {
    const next = current === 'done' ? 'pending' : 'done';
    startTransition(async () => {
      await updateExtraAction(id, { taskStatus: next });
      router.refresh();
    });
  };

  return (
    <>
      {extras.map((ex) => (
        <div
          key={ex.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '8px 0',
            borderBottom: '1px solid var(--border)',
            opacity: ex.taskStatus === 'done' ? 0.55 : 1,
          }}
        >
          <button
            className="small secondary"
            disabled={pending}
            style={{ minWidth: 64, fontSize: 11, flexShrink: 0 }}
            onClick={() => toggleStatus(ex.id, ex.taskStatus)}
          >
            {ex.taskStatus === 'done' ? 'Undo' : 'Mark done'}
          </button>
          <div style={{ flex: 1, fontSize: 13 }}>
            <strong style={{ textDecoration: ex.taskStatus === 'done' ? 'line-through' : 'none' }}>
              {ex.extra}
            </strong>
            {ex.time && <span className="muted"> · {ex.time}</span>}
            {ex.billing === 'comp'
              ? <span style={{ marginLeft: 6, background: '#d4edda', color: '#155724', borderRadius: 3, padding: '0 4px', fontSize: 11 }}>Free</span>
              : ex.price != null ? <span className="muted" style={{ marginLeft: 4, fontSize: 12 }}>£{ex.price}</span> : null}
            {ex.addedBy === 'staff' && <span className="muted" style={{ marginLeft: 4, fontSize: 11 }}>(staff)</span>}
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {ex.physicalRoom ? `Room ${ex.physicalRoom}` : ex.propertyName ?? ''}
              {ex.guestName ? ` — ${ex.guestName}` : ''}
            </div>
          </div>
          <span
            style={{
              fontSize: 11, padding: '2px 6px', borderRadius: 4, flexShrink: 0,
              background: ex.taskStatus === 'done' ? '#d4edda' : ex.taskStatus === 'in_progress' ? '#fff3cd' : '#f0f0f0',
              color: ex.taskStatus === 'done' ? '#155724' : ex.taskStatus === 'in_progress' ? '#856404' : '#555',
            }}
          >
            {ex.taskStatus.replace('_', ' ')}
          </span>
        </div>
      ))}
    </>
  );
}
