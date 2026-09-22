'use client';

import * as React from 'react';
import { Loader2, Lock, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { Project } from '@interior/core';
import type { ShareSession } from '@/lib/session';
import { getProjectLocal, remoteGet, setShareToken } from '@/lib/storage';
import { useEditorStore } from '@/stores/editor-store';
import { useSessionStore } from '@/stores/session-store';
import { EditorShell } from '@/components/editor/EditorShell';
import { ProtectedView } from '@/components/viewer/ProtectedView';

type Status = 'checking' | 'passcode' | 'loading' | 'ready' | 'denied' | 'missing';

/**
 * The client's entry point: `/view/<token>`.
 *
 * The token is validated on the server (signature, expiry, passcode) before
 * anything is fetched, and the session that comes back drives every gate in
 * the editor shell. The project is then loaded read-only — the store refuses
 * commands for this role, so even a UI slip cannot change the design.
 */
export function ViewerRoute({ token }: { token: string }) {
  const [status, setStatus] = React.useState<Status>('checking');
  const [session, setLocalSession] = React.useState<ShareSession | null>(null);
  const [passcode, setPasscode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const attempt = React.useCallback(
    async (code?: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/share/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, passcode: code ?? '' }),
        });
        const data = (await res.json().catch(() => ({}))) as { session?: ShareSession; needsPasscode?: boolean; error?: string };
        if (data.needsPasscode) {
          setStatus('passcode');
          if (data.error) setError(data.error);
          setBusy(false);
          return;
        }
        if (!res.ok || !data.session) {
          setError(data.error ?? 'This link is no longer valid.');
          setStatus('denied');
          setBusy(false);
          return;
        }
        setLocalSession(data.session);
        useSessionStore.getState().setSession(data.session);
        setStatus('loading');
      } catch {
        setError('Could not reach the server.');
        setStatus('denied');
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  React.useEffect(() => {
    // Authorises the project read that follows; scoped to this one project.
    setShareToken(token);
    void attempt();
    return () => setShareToken(null);
  }, [attempt, token]);

  // Load the project once the link checks out.
  React.useEffect(() => {
    if (status !== 'loading' || !session) return;
    let cancelled = false;

    const apply = (project: Project) => {
      if (cancelled) return;
      useEditorStore.getState().loadProject(project);
      setStatus('ready');
    };

    // The server copy is the shared one; the local copy only helps when the
    // architect opens their own link on the same machine.
    void remoteGet(session.projectId).then((remote) => {
      if (cancelled) return;
      if (remote) return apply(remote);
      const local = getProjectLocal(session.projectId);
      if (local) return apply(local);
      setStatus('missing');
    });

    return () => {
      cancelled = true;
    };
  }, [status, session]);

  if (status === 'checking' || status === 'loading') {
    return <Splash>{status === 'checking' ? 'Checking this link…' : 'Opening the design…'}</Splash>;
  }

  if (status === 'passcode') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090b10] px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(passcode);
          }}
          className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center"
        >
          <Lock className="mx-auto mb-3 h-7 w-7 text-sky-400" />
          <h1 className="text-sm font-semibold text-zinc-100">This design is passcode protected</h1>
          <p className="mt-1 text-xs text-zinc-500">Enter the passcode you were given.</p>
          <input
            autoFocus
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2.5 text-center text-sm tracking-widest text-zinc-100 outline-none focus:border-sky-500"
            placeholder="••••••"
          />
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {busy ? 'Checking…' : 'View design'}
          </button>
        </form>
      </div>
    );
  }

  if (status === 'denied' || status === 'missing' || !session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#090b10] px-6 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-400" />
        <p className="text-base font-medium text-zinc-100">
          {status === 'missing' ? 'This design is not available right now' : 'This link is not valid'}
        </p>
        <p className="max-w-md text-xs leading-relaxed text-zinc-500">
          {status === 'missing'
            ? 'The link is genuine, but the project has not reached the server yet. Ask whoever sent it to open the project once with syncing on.'
            : error ?? 'It may have expired, or it was revoked. Ask the sender for a fresh link.'}
        </p>
      </div>
    );
  }

  return (
    <ProtectedView label={session.label} projectId={session.projectId} watermark={session.watermark}>
      <div className="flex h-full w-full flex-col">
        <ViewerBanner session={session} />
        <div className="min-h-0 flex-1">
          <EditorShell />
        </div>
      </div>
    </ProtectedView>
  );
}

function ViewerBanner({ session }: { session: ShareSession }) {
  const expires = session.expiresAt ? new Date(session.expiresAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null;
  return (
    <div className="z-40 flex h-9 shrink-0 items-center justify-between gap-3 border-b border-zinc-800 bg-[#0b0f16] px-3 text-[11px] text-zinc-400">
      <span className="flex items-center gap-1.5 text-emerald-300">
        <ShieldCheck className="h-3.5 w-3.5" />
        Protected view — read only
      </span>
      <span className="truncate text-zinc-500">
        Shared with <span className="text-zinc-300">{session.label}</span>
        {expires ? ` · access ends ${expires}` : ''}
      </span>
    </div>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090b10] text-sm text-zinc-500">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-sky-500" />
        {children}
      </div>
    </div>
  );
}
