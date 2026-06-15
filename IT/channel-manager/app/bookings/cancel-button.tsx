'use client';

import { useTransition } from 'react';
import { cancelBooking } from '@/lib/actions';

export default function CancelButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="danger small"
      disabled={pending}
      onClick={() => {
        if (confirm('Cancel this booking? Availability will be restored and sync jobs queued.')) {
          startTransition(() => cancelBooking(id));
        }
      }}
    >
      {pending ? '…' : 'Cancel'}
    </button>
  );
}
