import { pendingSyncJobs, recentSyncJobs, type SyncJobWithRoom } from '@/lib/data';
import SyncJobActions, { BulkDoneButton } from './job-actions';

export const dynamic = 'force-dynamic';

type PriceRange = {
  ids: number[];
  channel: string;
  propertyName: string;
  roomTypeName: string;
  bdcRoomId: string | null;
  expediaName: string | null;
  from: string;
  to: string;
  value: string;
};

function nextDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Collapse per-date price jobs into contiguous same-price date ranges
function groupPriceRanges(jobs: SyncJobWithRoom[]): PriceRange[] {
  const byTarget = new Map<string, SyncJobWithRoom[]>();
  for (const j of jobs) {
    const key = `${j.channel}|${j.roomTypeId}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key)!.push(j);
  }
  const ranges: PriceRange[] = [];
  for (const list of byTarget.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    let cur: PriceRange | null = null;
    for (const j of list) {
      if (cur && j.value === cur.value && j.date === nextDay(cur.to)) {
        cur.to = j.date;
        cur.ids.push(j.id);
      } else {
        cur = {
          ids: [j.id],
          channel: j.channel,
          propertyName: j.propertyName,
          roomTypeName: j.roomTypeName,
          bdcRoomId: j.bdcRoomId,
          expediaName: j.expediaName,
          from: j.date,
          to: j.date,
          value: j.value,
        };
        ranges.push(cur);
      }
    }
  }
  return ranges.sort((a, b) =>
    a.channel !== b.channel ? (a.channel < b.channel ? -1 : 1)
    : a.propertyName !== b.propertyName ? (a.propertyName < b.propertyName ? -1 : 1)
    : a.roomTypeName !== b.roomTypeName ? (a.roomTypeName < b.roomTypeName ? -1 : 1)
    : a.from < b.from ? -1 : 1
  );
}

export default async function SyncPage() {
  const [jobs, recent] = await Promise.all([pendingSyncJobs(), recentSyncJobs(30)]);

  const inventoryJobs = jobs.filter((j) => j.field === 'inventory');
  const priceJobs = jobs.filter((j) => j.field === 'price');
  const priceRanges = groupPriceRanges(priceJobs);

  // Group inventory jobs by channel + property
  const invGroups = new Map<string, SyncJobWithRoom[]>();
  for (const j of inventoryJobs) {
    const key = `${j.channel} — ${j.propertyName}`;
    if (!invGroups.has(key)) invGroups.set(key, []);
    invGroups.get(key)!.push(j);
  }

  // Group price ranges by channel + property, then room type
  const priceGroups = new Map<string, Map<string, PriceRange[]>>();
  for (const r of priceRanges) {
    const key = `${r.channel} — ${r.propertyName}`;
    if (!priceGroups.has(key)) priceGroups.set(key, new Map());
    const rooms = priceGroups.get(key)!;
    if (!rooms.has(r.roomTypeName)) rooms.set(r.roomTypeName, []);
    rooms.get(r.roomTypeName)!.push(r);
  }

  // BDC console recipe for inventory jobs
  const bdcInv = inventoryJobs.filter((j) => j.channel === 'booking.com' && j.bdcRoomId);
  const bdcInvByProperty = new Map<string, SyncJobWithRoom[]>();
  for (const j of bdcInv) {
    if (!bdcInvByProperty.has(j.propertyName)) bdcInvByProperty.set(j.propertyName, []);
    bdcInvByProperty.get(j.propertyName)!.push(j);
  }

  return (
    <>
      <h1>Sync queue</h1>
      <p className="muted" style={{ marginBottom: 14 }}>
        {jobs.length === 0
          ? ''
          : `${inventoryJobs.length} inventory job${inventoryJobs.length === 1 ? '' : 's'}, ${priceJobs.length} price job${priceJobs.length === 1 ? '' : 's'} (collapsed into ${priceRanges.length} date range${priceRanges.length === 1 ? '' : 's'}). `}
        Push changes to the extranets via Claude in Chrome, then mark them done.
      </p>

      {jobs.length === 0 && <div className="card"><p className="muted">Queue is empty — everything is in sync. ✓</p></div>}

      {[...invGroups.entries()].map(([key, list]) => (
        <div className="card" key={key}>
          <h2 style={{ marginTop: 0 }}>
            <span className={`badge ${key.startsWith('booking.com') ? 'bdc' : 'expedia'}`}>{key.split(' — ')[0]}</span>{' '}
            {key.split(' — ')[1]} — inventory <span className="muted">({list.length})</span>
          </h2>
          <table>
            <thead>
              <tr><th>Room type</th><th>Date</th><th>Set to</th><th>Queued</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((j) => (
                <tr key={j.id}>
                  <td>
                    {j.roomTypeName}
                    {j.channel === 'booking.com' && (
                      <span className="mono muted"> {j.bdcRoomId ? `#${j.bdcRoomId}` : '(BDC ID TBD)'}</span>
                    )}
                    {j.channel === 'expedia' && j.expediaName && (
                      <div className="muted" style={{ fontSize: 11.5 }}>Expedia: {j.expediaName}</div>
                    )}
                  </td>
                  <td className="mono">{j.date}</td>
                  <td><strong>{j.value}</strong></td>
                  <td className="muted">{String(j.createdAt).slice(0, 16).replace('T', ' ')}</td>
                  <td><SyncJobActions id={j.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {[...priceGroups.entries()].map(([key, rooms]) => {
        const allIds = [...rooms.values()].flat().flatMap((r) => r.ids);
        const rangeCount = [...rooms.values()].reduce((s, r) => s + r.length, 0);
        return (
          <div className="card" key={`price-${key}`}>
            <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={`badge ${key.startsWith('booking.com') ? 'bdc' : 'expedia'}`}>{key.split(' — ')[0]}</span>
              {key.split(' — ')[1]} — prices <span className="muted">({rangeCount} ranges)</span>
              <span style={{ marginLeft: 'auto' }}><BulkDoneButton ids={allIds} label="Mark all done" /></span>
            </h2>
            {[...rooms.entries()].map(([roomName, ranges]) => (
              <details key={roomName} style={{ marginBottom: 8 }}>
                <summary style={{ cursor: 'pointer', padding: '4px 0' }}>
                  <strong>{roomName}</strong>{' '}
                  {ranges[0].bdcRoomId && key.startsWith('booking.com') && <span className="mono muted">#{ranges[0].bdcRoomId}</span>}
                  {ranges[0].expediaName && key.startsWith('expedia') && <span className="muted" style={{ fontSize: 12 }}> ({ranges[0].expediaName})</span>}
                  <span className="muted"> — {ranges.length} ranges, {ranges[0].from} → {ranges[ranges.length - 1].to}</span>
                </summary>
                <table style={{ marginTop: 6 }}>
                  <thead><tr><th>From</th><th>To</th><th>Nights</th><th>Price</th><th></th></tr></thead>
                  <tbody>
                    {ranges.map((r) => (
                      <tr key={r.ids[0]}>
                        <td className="mono">{r.from}</td>
                        <td className="mono">{r.to}</td>
                        <td>{r.ids.length}</td>
                        <td><strong>£{r.value}</strong></td>
                        <td><BulkDoneButton ids={r.ids} label="Done" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
          </div>
        );
      })}

      {bdcInvByProperty.size > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Booking.com console recipe — inventory (copy-paste)</h2>
          <p className="muted" style={{ marginBottom: 10, fontSize: 12.5 }}>
            Open the Partner Hub Availability calendar (list view) for the property, paste your{' '}
            <span className="mono">setRoomInventory()</span> helper in the console, then run:
          </p>
          {[...bdcInvByProperty.entries()].map(([prop, list]) => (
            <div key={prop}>
              <h2>{prop}</h2>
              <pre className="instructions">
                {list
                  .map((j) => `await setRoomInventory('${j.bdcRoomId}', '${j.date}', ${j.value}); // ${j.roomTypeName}`)
                  .join('\n')}
              </pre>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Recently processed</h2>
        {recent.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <table>
            <thead><tr><th>Channel</th><th>Property</th><th>Room type</th><th>Date</th><th>Field</th><th>Value</th><th>Status</th></tr></thead>
            <tbody>
              {recent.map((j) => (
                <tr key={j.id}>
                  <td><span className={`badge ${j.channel === 'booking.com' ? 'bdc' : 'expedia'}`}>{j.channel}</span></td>
                  <td>{j.propertyName}</td>
                  <td>{j.roomTypeName}</td>
                  <td className="mono">{j.date}</td>
                  <td>{j.field}</td>
                  <td>{j.value}</td>
                  <td><span className={`badge ${j.status}`}>{j.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
