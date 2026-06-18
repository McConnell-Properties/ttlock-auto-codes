export const dynamic = 'force-dynamic';

export default function InboxPage() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>✉</div>
      <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
        Guest inbox coming soon
      </p>
      <p style={{ fontSize: 13, maxWidth: 380, margin: '0 auto' }}>
        P1 is building the Beds24 message pull into the <code>Message</code> table.
        Once that ships, guest messages will appear here — searchable, filterable by property.
      </p>
    </div>
  );
}
