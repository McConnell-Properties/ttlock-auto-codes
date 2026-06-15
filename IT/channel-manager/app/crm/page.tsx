import { crmRows, extrasTasks, today } from '@/lib/data';
import CrmBoard from './board';

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  let rows: Awaited<ReturnType<typeof crmRows>> = [];
  let extras: Awaited<ReturnType<typeof extrasTasks>> = [];
  let migrationNeeded = false;
  try {
    [rows, extras] = await Promise.all([crmRows(7, 30), extrasTasks()]);
  } catch {
    migrationNeeded = true;
  }
  return (
    <>
      <h1>CRM — guest journey</h1>
      {migrationNeeded ? (
        <div className="card">
          <p>The CRM tables aren&apos;t set up yet. In Terminal:</p>
          <pre className="instructions">cd &quot;/Users/charliemcconnell/ttlock-auto-codes/IT/channel-manager&quot; && node db/migrate-crm.mjs</pre>
          <p className="muted">Then refresh this page.</p>
        </div>
      ) : (
        <CrmBoard rows={JSON.parse(JSON.stringify(rows))} extras={JSON.parse(JSON.stringify(extras))} today={today()} />
      )}
    </>
  );
}
