import { NextResponse } from 'next/server';
import { sign, safeEqual, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/token';
import type { AccountPayload } from '@/lib/session';

/**
 * Sign-in for the seeded account.
 *
 * The check happens on the server and the result is an httpOnly, signed
 * cookie, so the client cannot mint a session for itself by writing to
 * localStorage. Credentials come from the environment; the defaults exist so
 * the product runs out of the box and are meant to be overridden.
 */
const EMAIL = process.env.AUTH_EMAIL ?? 'ganeshmesta1234@gmail.com';
const PASSWORD = process.env.AUTH_PASSWORD ?? 'Ganesh@123';
const NAME = process.env.AUTH_NAME ?? 'Ganesh Mesta';

/** Crude in-process throttle: enough to make guessing pointless on one box. */
const attempts = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

function throttled(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.until) {
    attempts.set(ip, { count: 1, until: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  if (throttled(ip)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a minute and try again.' }, { status: 429 });
  }

  let email = '';
  let password = '';
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    email = (body.email ?? '').trim();
    password = body.password ?? '';
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  const ok = safeEqual(email.toLowerCase(), EMAIL.toLowerCase()) && safeEqual(password, PASSWORD);
  if (!ok) {
    // One message for both cases: never reveal which half was wrong.
    return NextResponse.json({ error: 'That email and password combination is not recognised.' }, { status: 401 });
  }

  const payload: AccountPayload = {
    sub: EMAIL,
    name: NAME,
    r: 'owner',
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const token = await sign(payload);

  const response = NextResponse.json({ email: EMAIL, name: NAME, role: 'owner' });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return response;
}
