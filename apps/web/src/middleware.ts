import { NextResponse, type NextRequest } from 'next/server';
import { verify, SESSION_COOKIE } from '@/lib/token';
import type { AccountPayload } from '@/lib/session';

/**
 * The actual gate.
 *
 * Every page except the login screen and a share link requires a valid signed
 * session cookie, checked here on the server before anything renders. Hiding
 * buttons in the UI is presentation; this is the part that decides who gets
 * the page at all.
 */
const PUBLIC_PATHS = ['/login', '/view'];
const PUBLIC_APIS = ['/api/auth/login', '/api/auth/logout', '/api/auth/session', '/api/share/verify', '/api/events'];
/** The storage proxy does its own check: a session *or* a share token scoped to one project. */
const SELF_GUARDED_PREFIXES = ['/api/backend'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_APIS.some((p) => pathname === p)) return true;
  if (SELF_GUARDED_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verify<AccountPayload>(token);
  if (session) return NextResponse.next();

  // API calls get a status they can act on; pages get sent to the sign-in
  // screen with a note of where they were headed.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  if (pathname !== '/') url.searchParams.set('next', pathname + search);
  const response = NextResponse.redirect(url);
  if (token) response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)'],
};
