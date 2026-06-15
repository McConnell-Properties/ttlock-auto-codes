'use client';

import { useTransition } from 'react';
import { markSyncJob, markSyncJobs } from '@/lib/actions';

export default function SyncJobActions({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button className="small" disabled={pending} onClick={() => startTransition(() => markSyncJob(id, 'done'))}>
        Done
      </button>
      <button className="small danger" disabled={pending} onClick={() => startTransition(() => markSyncJob(id, 'failed'))}>
        Failed
      </button>
    </span>
  );
}

export function BulkDoneButton({ ids, label }: { ids: number[]; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="small"
      disabled={pending}
      onClick={() => {
        if (ids.length > 50 && !confirm(`Mark ${ids.length} jobs as done?`)) return;
        startTransition(() => markSyncJobs(ids, 'done'));
      }}
    >
      {pending ? '…' : `${label} (${ids.length})`}
    </button>
  );
}
