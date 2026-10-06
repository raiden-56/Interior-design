import { NextResponse } from 'next/server';
import { verify, sha256, safeEqual } from '@/lib/token';
import type { SharePayload, ShareSession } from '@/lib/session';
import { recordEvent } from '@/lib/audit';

/**
 * Exchanges a share token (plus its passcode, if it has one) for the session
 * the viewer page runs under.
 *
 * The passcode is checked here rather than in the browser so the answer is
 * never sitting in the page for someone to read out of the bundle.
 */
export async function POST(request: Request) {
  let token = '';
  let passcode = '';
  try {
    const body = (await request.json()) as { token?: string; passcode?: string };
    token = body.token ?? '';
    passcode = body.passcode ?? '';
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  const payload = await verify<SharePayload>(token);
  if (!payload) {
    return NextResponse.json({ error: 'This link is not valid any more. Ask for a fresh one.' }, { status: 403 });
  }

  if (payload.pc) {
    if (!passcode) return NextResponse.json({ needsPasscode: true }, { status: 401 });
    const given = await sha256(passcode);
    if (!safeEqual(given, payload.pc)) {
      recordEvent({ kind: 'share-passcode-failed', projectId: payload.p, label: payload.l });
      return NextResponse.json({ needsPasscode: true, error: 'Wrong passcode.' }, { status: 401 });
    }
  }

  const session: ShareSession = {
    kind: 'share',
    projectId: payload.p,
    role: payload.r,
    label: payload.l,
    expiresAt: payload.exp || null,
    allowComments: payload.cm,
    watermark: payload.wm,
    allowWalkthrough: payload.wt !== false,
  };

  recordEvent({
    kind: 'share-opened',
    projectId: payload.p,
    label: payload.l,
    role: payload.r,
    userAgent: request.headers.get('user-agent') ?? '',
  });

  return NextResponse.json({ session });
}
