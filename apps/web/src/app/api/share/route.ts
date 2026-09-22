import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sign, verify, sha256, SESSION_COOKIE } from '@/lib/token';
import { can, type AccountPayload, type Role, type SharePayload } from '@/lib/session';

/**
 * Mints a share link for one project.
 *
 * Only a signed-in account with the `share` permission can create one, and the
 * link it gets back is a signed token that names the project, the role it
 * grants and when it stops working. Nothing about the recipient is trusted:
 * the role travels inside the signature, so a client cannot promote their own
 * link to an editable one.
 */
const MAX_TTL_DAYS = 365;

export async function POST(request: Request) {
  const store = await cookies();
  const account = await verify<AccountPayload>(store.get(SESSION_COOKIE)?.value);
  if (!account || !can(account.r, 'share')) {
    return NextResponse.json({ error: 'Sign in as the project owner to share.' }, { status: 401 });
  }

  let body: {
    projectId?: string;
    role?: Role;
    label?: string;
    expiresInDays?: number | null;
    passcode?: string;
    allowComments?: boolean;
    watermark?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  const projectId = (body.projectId ?? '').trim();
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 });

  // A share link can never grant more than the account holds, and an owner
  // link is deliberately not offered — sharing full control by URL is how
  // people lose a project.
  const role: Role = body.role === 'editor' ? 'editor' : 'viewer';
  const days = body.expiresInDays === null ? 0 : Math.min(Math.max(Number(body.expiresInDays ?? 14), 0), MAX_TTL_DAYS);
  const passcode = (body.passcode ?? '').trim();

  const payload: SharePayload = {
    p: projectId,
    r: role,
    l: (body.label ?? '').trim().slice(0, 60) || 'Shared by ' + account.name,
    iat: Date.now(),
    exp: days > 0 ? Date.now() + days * 24 * 60 * 60 * 1000 : 0,
    pc: passcode ? await sha256(passcode) : '',
    cm: role === 'viewer' ? Boolean(body.allowComments) : true,
    wm: body.watermark !== false,
  };

  const token = await sign(payload);
  return NextResponse.json({
    token,
    path: `/view/${token}`,
    role,
    expiresAt: payload.exp || null,
    requiresPasscode: Boolean(payload.pc),
  });
}
