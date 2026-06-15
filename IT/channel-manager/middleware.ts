// Auth gate for deployment. Does nothing until ADMIN_PASSWORD is set in .env,
// so local dev keeps working unchanged.
//
// - Admin pages: require the signed session cookie (set by /login).
// - /api/*: require `Authorization: Bearer <CM_API_KEY>` (for the booking site)
//   or a valid admin cookie.
// - /api/stripe/webhook is always open (it verifies its own Stripe signature).
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from './lib/auth';

export async function middleware(req: NextRequest) {
  if (!process.env.ADMIN_PASSWORD) return NextResponse.next(); // auth disabled (local dev)

  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname === '/api/stripe/webhook') {
    return NextResponse.next();
  }

  const hasSession = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith('/api/')) {
    const auth = req.headers.get('authorization') || '';
    const apiKey = process.env.CM_API_KEY;
    if (apiKey && auth === `Bearer ${apiKey}`) return NextResponse.next();
    if (hasSession) return NextResponse.next();
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (hasSession) return NextResponse.next();

  const login = req.nextUrl.clone();
  login.pathname = '/login';
  login.searchParams.set('from', pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // everything except Next internals & static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
