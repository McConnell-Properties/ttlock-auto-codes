// Requires BLOB_INBOX_URL env var (Vercel Blob public URL for messages-dashboard.html)
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.BLOB_INBOX_URL;
  if (!url) {
    return new NextResponse(
      '<html><body style="font:14px sans-serif;padding:32px;color:#666">Inbox not configured — set <code>BLOB_INBOX_URL</code> in Vercel env vars.</body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
  const res = await fetch(url, { cache: 'no-store' });
  const html = await res.text();
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
