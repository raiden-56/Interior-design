import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verify, SESSION_COOKIE } from '@/lib/token';
import type { AccountPayload } from '@/lib/session';

/** Who am I? Used by the client to decide what to render. */
export async function GET() {
  const store = await cookies();
  const payload = await verify<AccountPayload>(store.get(SESSION_COOKIE)?.value);
  if (!payload) return NextResponse.json({ session: null }, { status: 200 });
  return NextResponse.json({
    session: { kind: 'account', email: payload.sub, name: payload.name, role: payload.r },
  });
}
