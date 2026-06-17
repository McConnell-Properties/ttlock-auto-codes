export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { runBeds24Push } from '@/lib/beds24-push';

export async function POST(req: Request) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  try {
    const result = await runBeds24Push({ dryRun: false });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/push]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
