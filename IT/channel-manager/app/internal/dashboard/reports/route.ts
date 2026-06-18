// Requires BLOB_REPORTS_URL env var (Vercel Blob public URL for dashboard-embed.html)
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.BLOB_REPORTS_URL;
  if (!url) {
    return new NextResponse(
      '<html><body style="font:14px sans-serif;padding:32px;color:#666">Reports not configured — set <code>BLOB_REPORTS_URL</code> in Vercel env vars.</body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
  const res = await fetch(url);
  const html = await res.text();
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
