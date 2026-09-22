import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify, SESSION_COOKIE } from '@/lib/token';
import { can, type AccountPayload, type SharePayload } from '@/lib/session';

/**
 * Authenticated proxy in front of the project store.
 *
 * The browser used to talk to the FastAPI service directly, which meant the
 * service had to be reachable from wherever the app is — and anything that
 * could reach it could read and overwrite every project. Requests now go
 * through here: the session cookie (or a share token naming one project) is
 * checked on the server, and only then is the call forwarded, with the
 * service's own credential attached from server-side environment.
 *
 * The upstream service therefore never needs a public address.
 */
const UPSTREAM = (process.env.API_ORIGIN ?? process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000/api/v1').replace(/\/$/, '');
const API_TOKEN = process.env.API_TOKEN ?? '';

type Access = { ok: true; projectScope: string | null } | { ok: false; status: number; error: string };

async function authorise(request: Request, method: string, path: string): Promise<Access> {
  // The reachability probe reveals nothing and is needed before sign-in.
  if (path === 'health') return { ok: true, projectScope: null };

  const store = await cookies();
  const account = await verify<AccountPayload>(store.get(SESSION_COOKIE)?.value);
  if (account) {
    if (method !== 'GET' && !can(account.r, 'edit')) {
      return { ok: false, status: 403, error: 'Read-only session' };
    }
    return { ok: true, projectScope: null };
  }

  // A client holding a share link may read the one project it names.
  const shareToken = request.headers.get('x-share-token');
  const share = await verify<SharePayload>(shareToken);
  if (share) {
    if (method !== 'GET') return { ok: false, status: 403, error: 'This link is read-only' };
    return { ok: true, projectScope: share.p };
  }

  return { ok: false, status: 401, error: 'Sign in required' };
}

async function forward(request: Request, segments: string[]): Promise<Response> {
  const path = segments.join('/');
  const access = await authorise(request, request.method, path);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  // A share token is scoped to a single project: no listing, no other ids.
  if (access.projectScope) {
    const allowed = `projects/${access.projectScope}`;
    if (path !== allowed) return NextResponse.json({ error: 'Out of scope for this link' }, { status: 403 });
  }

  const url = `${UPSTREAM}/${path}${new URL(request.url).search}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (API_TOKEN) headers['x-api-token'] = API_TOKEN;

  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.text(),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    // The app is offline-first: a missing service is a normal state, not an error.
    return NextResponse.json({ error: 'Storage service unavailable' }, { status: 503 });
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path);
}
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path);
}
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path);
}
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path);
}
