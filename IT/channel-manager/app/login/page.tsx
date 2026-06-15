import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, makeSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function login(formData: FormData) {
  'use server';
  const password = String(formData.get('password') || '');
  const from = String(formData.get('from') || '/');
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    redirect(`/login?error=1&from=${encodeURIComponent(from)}`);
  }
  cookies().set(SESSION_COOKIE, await makeSession(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 3600,
    path: '/',
  });
  redirect(from.startsWith('/') ? from : '/');
}

export default function LoginPage({ searchParams }: { searchParams: { error?: string; from?: string } }) {
  return (
    <div className="card" style={{ maxWidth: 360, margin: '80px auto' }}>
      <h1 style={{ marginTop: 0 }}>Channel manager</h1>
      {searchParams.error && <p style={{ color: 'var(--red, #c00)' }}>Wrong password — try again.</p>}
      <form action={login}>
        <input type="hidden" name="from" value={searchParams.from || '/'} />
        <input
          type="password" name="password" placeholder="Password" autoFocus required
          style={{ width: '100%', padding: '8px 10px', marginBottom: 10 }}
        />
        <button type="submit" style={{ padding: '8px 14px' }}>Sign in</button>
      </form>
    </div>
  );
}
