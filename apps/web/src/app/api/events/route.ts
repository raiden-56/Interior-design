import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify, SESSION_COOKIE } from '@/lib/token';
import type { AccountPayload } from '@/lib/session';
import { recordEvent, recentEvents, type AuditEvent } from '@/lib/audit';

/** The protected viewer reports here when someone tries to capture or print. */
export async function POST(request: Request) {
  let body: { kind?: AuditEvent['kind']; projectId?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const allowed: AuditEvent['kind'][] = ['capture-attempt', 'print-attempt', 'devtools-attempt'];
  if (!body.kind || !allowed.includes(body.kind) || !body.projectId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  recordEvent({ kind: body.kind, projectId: body.projectId, label: body.label, userAgent: request.headers.get('user-agent') ?? '' });
  return NextResponse.json({ ok: true });
}

/** Only the account holder can read the trail. */
export async function GET(request: Request) {
  const store = await cookies();
  const account = await verify<AccountPayload>(store.get(SESSION_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get('projectId') ?? undefined;
  return NextResponse.json({ events: recentEvents(projectId) });
}
