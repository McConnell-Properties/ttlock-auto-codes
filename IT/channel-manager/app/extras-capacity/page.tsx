export const dynamic = 'force-dynamic';

import { listExtraCapacities } from '@/lib/data';
import { EXTRAS } from '@/lib/extras';
import CapacityEditor from './capacity-editor';

export default async function ExtrasCapacityPage() {
  const capacities = await listExtraCapacities();
  const capMap = Object.fromEntries(capacities.map((c) => [c.extraId, c.capacity]));

  // Check if we got live Turso data or fell back to hardcoded defaults
  let fromTurso = false;
  try {
    const { db } = await import('@/lib/db');
    await db.execute('SELECT 1 FROM ExtraCapacity LIMIT 1');
    fromTurso = true;
  } catch { /* migration not yet applied */ }

  const rows = EXTRAS.map((e) => ({
    extraId: e.id,
    label: e.label,
    capacity: capMap[e.id] ?? 1,
    fromTurso,
  }));

  return (
    <>
      <h1>Extras capacity</h1>
      <p className="muted" style={{ marginBottom: 14 }}>
        Set how many units are available to sell per night for each add-on.
        Parking = number of spaces; Vented aircon = number of units; Cooking pack = stock.
      </p>

      {!fromTurso && (
        <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
          <strong>Migration pending</strong> — ExtraCapacity table not yet on prod.
          Showing hardcoded defaults. Run <code>db/migrate-extras-capacity.mjs --live</code> to enable editing.
        </div>
      )}

      <div className="card">
        <CapacityEditor rows={rows} />
      </div>
    </>
  );
}
