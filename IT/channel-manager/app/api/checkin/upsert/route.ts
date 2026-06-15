import { NextRequest, NextResponse } from 'next/server';
import { upsertCheckin } from '@/lib/data';

export const dynamic = 'force-dynamic';

const CONTACT_METHOD_ENUM = ['phone', 'email', 'whatsapp'];

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const { ref } = body || {};
  if (!ref || typeof ref !== 'string' || !ref.trim()) {
    return NextResponse.json({ error: 'ref is required' }, { status: 400 });
  }

  if (body.contact != null) {
    const methods = body.contact?.contactMethods;
    // contactMethods is optional — callers may send only cardSaved/earlyCheckin/etc.
    if (methods != null) {
      if (!Array.isArray(methods) || methods.length === 0) {
        return NextResponse.json({ error: 'contact.contactMethods must be a non-empty array if provided' }, { status: 400 });
      }
      for (const m of methods) {
        if (!CONTACT_METHOD_ENUM.includes(m?.method)) {
          return NextResponse.json({ error: `invalid contact method: ${m?.method}` }, { status: 400 });
        }
      }
    }
  }

  const result = await upsertCheckin(ref.trim(), {
    confirmedAt: body.confirmedAt ?? null,
    contact: body.contact ?? null,
    extras: body.extras ?? [],
    updatedAt: body.updatedAt,
  });

  return NextResponse.json({ ok: true, ...result });
}
