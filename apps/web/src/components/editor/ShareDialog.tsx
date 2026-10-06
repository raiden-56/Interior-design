'use client';

import * as React from 'react';
import { Copy, Check, Link2, ShieldCheck, Loader2, Eye, Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useEditorStore } from '@/stores/editor-store';
import { ROLE_HINTS, type Role } from '@/lib/session';
import { cn } from '@/lib/cn';

/**
 * Creates the link an architect sends to a client.
 *
 * The important choices are on one screen — who it is for, what they can do,
 * how long it lasts, whether it needs a passcode — because those are the
 * decisions people get wrong when they are buried in a settings page. The
 * token is minted server-side and carries all of it inside its signature.
 */
const EXPIRY_OPTIONS = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 0, label: 'No expiry' },
];

export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const saveNow = useEditorStore((s) => s.saveNow);
  const pushToast = useEditorStore((s) => s.pushToast);

  const [role, setRole] = React.useState<Role>('viewer');
  const [label, setLabel] = React.useState('');
  const [days, setDays] = React.useState(14);
  const [passcode, setPasscode] = React.useState('');
  const [watermark, setWatermark] = React.useState(true);
  const [allowWalkthrough, setAllowWalkthrough] = React.useState(true);
  const [link, setLink] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setLink(null);
      setCopied(false);
      setError(null);
    }
  }, [open]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      // The recipient reads the project from the server, so make sure the
      // server has the current version before handing out the link.
      await saveNow();
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          role,
          label: label.trim(),
          expiresInDays: days === 0 ? null : days,
          passcode: passcode.trim(),
          watermark,
          allowWalkthrough,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok || !data.path) {
        setError(data.error ?? 'Could not create the link.');
        return;
      }
      setLink(window.location.origin + data.path);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      pushToast('Client link copied', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed — select the link and copy it manually.');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Share this design" width="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Who is it for</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Client name or email — shown in the watermark"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/60"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">What they can do</label>
          <div className="grid grid-cols-2 gap-2">
            <RoleCard active={role === 'viewer'} onClick={() => setRole('viewer')} icon={<Eye className="h-4 w-4" />} title="View only" hint={ROLE_HINTS.viewer} />
            <RoleCard active={role === 'editor'} onClick={() => setRole('editor')} icon={<Pencil className="h-4 w-4" />} title="Can edit" hint={ROLE_HINTS.editor} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Access ends</label>
            <div className="flex flex-wrap gap-1">
              {EXPIRY_OPTIONS.map((o) => (
                <button
                  key={o.days}
                  onClick={() => setDays(o.days)}
                  className={cn(
                    'rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-zinc-700',
                    days === o.days && 'border-sky-500/50 bg-sky-500/10 text-sky-300',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Passcode (optional)</label>
            <input
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Leave empty for an open link"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/60"
            />
          </div>
        </div>

        {role === 'viewer' && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <input type="checkbox" checked={allowWalkthrough} onChange={(e) => setAllowWalkthrough(e.target.checked)} className="mt-0.5 accent-sky-500" />
            <span className="text-xs leading-relaxed text-zinc-300">
              Allow the 3D walkthrough
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                They can walk through the rooms in first person, open doors and sit on the furniture. Nothing they do in there
                changes the design, and the view stays watermarked and export-free.
              </span>
            </span>
          </label>
        )}

        {role === 'viewer' && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} className="mt-0.5 accent-sky-500" />
            <span className="text-xs leading-relaxed text-zinc-300">
              Watermark the view with their name
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                Downloads, exports and printing are always off for a view-only link, and capture attempts are logged. A watermark is what
                makes a screenshot that does get taken traceable back to this link — no web page can block a phone camera or an OS
                screen recorder.
              </span>
            </span>
          </label>
        )}

        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        {link ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" /> Link ready
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-1.5 text-[11px] text-zinc-300 outline-none"
              />
              <button onClick={copy} className="flex shrink-0 items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              Anyone with this link can open the design{passcode.trim() ? ' once they enter the passcode' : ''}. They do not need an account.
            </p>
          </div>
        ) : (
          <button
            onClick={() => void create()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {busy ? 'Preparing…' : 'Create client link'}
          </button>
        )}
      </div>
    </Dialog>
  );
}

function RoleCard({
  active,
  onClick,
  icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-left hover:border-zinc-700',
        active && 'border-sky-500/60 bg-sky-500/10',
      )}
    >
      <span className={cn('flex items-center gap-1.5 text-xs font-medium text-zinc-200', active && 'text-sky-300')}>
        {icon}
        {title}
      </span>
      <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">{hint}</span>
    </button>
  );
}
