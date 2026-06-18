'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/internal/dashboard/reports', label: 'Reports' },
  { href: '/internal/dashboard/inbox', label: 'Guest Inbox' },
];

export default function DashboardTabs() {
  const path = usePathname();
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          style={{
            padding: '8px 18px',
            fontSize: 13.5,
            fontWeight: path === t.href ? 600 : 400,
            color: path === t.href ? 'var(--accent)' : 'var(--muted)',
            borderBottom: path === t.href ? '2px solid var(--accent)' : '2px solid transparent',
            textDecoration: 'none',
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
