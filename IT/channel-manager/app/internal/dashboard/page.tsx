'use client';

import { useState } from 'react';

const TABS = [
  { id: 'inbox', label: 'Guest Inbox', src: '/internal/dashboard/inbox' },
  { id: 'reports', label: 'Reports', src: '/internal/dashboard/reports' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function InternalDashboard() {
  const [active, setActive] = useState<TabId>('inbox');

  return (
    <div style={{ margin: '-24px -28px', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', flexShrink: 0, background: '#fff' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            style={{
              padding: '10px 20px',
              fontSize: 13.5,
              fontWeight: active === t.id ? 600 : 400,
              color: active === t.id ? 'var(--accent)' : 'var(--muted)',
              background: 'none',
              border: 'none',
              borderBottom: active === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <iframe
          key={t.id}
          src={t.src}
          style={{
            flex: 1,
            width: '100%',
            border: 0,
            display: active === t.id ? 'block' : 'none',
          }}
          title={t.label}
        />
      ))}
    </div>
  );
}
