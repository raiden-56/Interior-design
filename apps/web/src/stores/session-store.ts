'use client';

import { create } from 'zustand';
import { sessionAllows, type Permissions, type Role, type Session } from '@/lib/session';

/**
 * Who is looking at the app, client-side.
 *
 * Two ways in: a signed-in account (fetched from `/api/auth/session`) or a
 * share link (handed over by the viewer route after the server validated the
 * token). Every gate in the UI reads `useCan(...)` from here.
 *
 * This store decides what to *render*. It is not the security boundary — the
 * middleware and the API routes are. A client that lies to this store still
 * cannot load a page or mint a link.
 */
interface SessionState {
  session: Session | null;
  loaded: boolean;
  setSession: (session: Session | null) => void;
  loadAccount: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useSessionStore = create<SessionState>()((set) => ({
  session: null,
  loaded: false,
  setSession: (session) => set({ session, loaded: true }),
  loadAccount: async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      const data = (await res.json()) as { session: Session | null };
      set({ session: data.session, loaded: true });
    } catch {
      set({ session: null, loaded: true });
    }
  },
  signOut: async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    set({ session: null });
    window.location.assign('/login');
  },
}));

export function useRole(): Role | null {
  return useSessionStore((s) => s.session?.role ?? null);
}

/**
 * Permission check. Defaults to *allowed* until the session has loaded on an
 * account page, so the editor does not flash a read-only shell for a frame
 * every time it mounts; a share session is applied synchronously by the
 * viewer route, so the protected view never has that gap.
 */
export function useCan(action: keyof Permissions): boolean {
  return useSessionStore((s) => {
    if (!s.loaded) return action !== 'protectedView';
    return sessionAllows(s.session, action);
  });
}

export function useIsShareSession(): boolean {
  return useSessionStore((s) => s.session?.kind === 'share');
}

/** Non-reactive read for code paths outside React (stores, canvas controllers). */
export function sessionCan(action: keyof Permissions): boolean {
  const state = useSessionStore.getState();
  if (!state.loaded) return action !== 'protectedView';
  return sessionAllows(state.session, action);
}
