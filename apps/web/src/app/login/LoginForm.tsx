'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Layers, Loader2, Lock, Mail, AlertTriangle, Eye, EyeOff } from 'lucide-react';

/**
 * Sign-in for the one seeded account.
 *
 * The form posts to `/api/auth/login`; the server sets an httpOnly cookie and
 * the middleware does the enforcing. Nothing here decides whether access is
 * granted, so nothing here can be bypassed by editing the page.
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Sign-in failed.');
        setBusy(false);
        return;
      }
      // A full navigation, so the middleware re-runs with the new cookie.
      window.location.assign(next.startsWith('/') ? next : '/');
    } catch {
      setError('Could not reach the server. Is the app running?');
      setBusy(false);
    }
  };

  void router;

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
          <Layers className="h-6 w-6" />
        </span>
        <h1 className="text-xl font-semibold text-zinc-100">Sign in to Interior Studio</h1>
        <p className="mt-1 text-sm text-zinc-500">Your projects, templates and client links.</p>
      </div>

      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Email</span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950/60 py-2.5 pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500"
            />
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Password</span>
          <span className="relative block">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950/60 py-2.5 pl-9 pr-10 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 hover:text-zinc-300"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
        </label>

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-600">
        Clients don&apos;t need an account — they open the read-only link you send them.
      </p>
    </div>
  );
}
