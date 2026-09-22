'use client';

import * as React from 'react';
import { ShieldAlert } from 'lucide-react';

/**
 * Hardening for a client-facing link.
 *
 * What this genuinely does: removes every in-app path to a file (no export,
 * no download, no print), stamps an identifying watermark over the design,
 * hides the content whenever the window loses focus (which is what most
 * capture tools do to take a shot), blocks copy/drag/context-menu and the
 * usual capture and devtools shortcuts, overwrites the clipboard after a
 * PrintScreen, and reports every attempt back to the architect's activity log.
 *
 * What no web page can do, this one included: stop a phone camera, an OS
 * screen recorder, or a determined user with devtools. A browser has no API
 * for that. The point of the layer below is that casual copying is awkward and
 * anything that does escape carries a watermark naming the link it came from.
 */
export function ProtectedView({
  label,
  projectId,
  enabled = true,
  watermark = true,
  children,
}: {
  label: string;
  projectId: string;
  enabled?: boolean;
  watermark?: boolean;
  children: React.ReactNode;
}) {
  const [obscured, setObscured] = React.useState(false);
  const [warning, setWarning] = React.useState<string | null>(null);
  const warningTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const report = React.useCallback(
    (kind: 'capture-attempt' | 'print-attempt' | 'devtools-attempt', message: string) => {
      setWarning(message);
      if (warningTimer.current) clearTimeout(warningTimer.current);
      warningTimer.current = setTimeout(() => setWarning(null), 4000);
      void fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, projectId, label }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [projectId, label],
  );

  React.useEffect(() => {
    if (!enabled) return;

    const swallow = (e: Event) => {
      e.preventDefault();
      return false;
    };

    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      e.clipboardData?.setData('text/plain', `Protected design — shared with ${label}. Copying is disabled.`);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (k === 'p' || k === 's' || k === 'u')) {
        e.preventDefault();
        report(k === 'p' ? 'print-attempt' : 'capture-attempt', 'Saving and printing are disabled on this link.');
        return;
      }
      if (k === 'f12' || (mod && e.shiftKey && (k === 'i' || k === 'j' || k === 'c'))) {
        e.preventDefault();
        report('devtools-attempt', 'Developer tools are disabled on this link.');
      }
    };

    // PrintScreen reaches the page only on key-up, and only after Windows has
    // already put the pixels on the clipboard — so the response is to replace
    // what is on the clipboard and tell the owner it happened.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'PrintScreen') return;
      setObscured(true);
      setTimeout(() => setObscured(false), 1200);
      navigator.clipboard
        ?.writeText(`Protected design — shared with ${label}. Screenshots of this link are logged.`)
        .catch(() => undefined);
      report('capture-attempt', 'Screen capture is not permitted on this link — the attempt has been logged.');
    };

    // Most capture tools (Snipping Tool, Snip & Sketch, screen recorders)
    // take focus away from the page first.
    const onBlur = () => setObscured(true);
    const onFocus = () => setObscured(false);
    const onVisibility = () => setObscured(document.visibilityState !== 'visible');
    const onBeforePrint = () => report('print-attempt', 'Printing is disabled on this link.');

    document.addEventListener('contextmenu', swallow);
    document.addEventListener('dragstart', swallow);
    document.addEventListener('selectstart', swallow);
    document.addEventListener('copy', onCopy as EventListener);
    document.addEventListener('cut', onCopy as EventListener);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('beforeprint', onBeforePrint);
    document.addEventListener('visibilitychange', onVisibility);
    document.body.classList.add('protected-view');

    return () => {
      document.removeEventListener('contextmenu', swallow);
      document.removeEventListener('dragstart', swallow);
      document.removeEventListener('selectstart', swallow);
      document.removeEventListener('copy', onCopy as EventListener);
      document.removeEventListener('cut', onCopy as EventListener);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('beforeprint', onBeforePrint);
      document.removeEventListener('visibilitychange', onVisibility);
      document.body.classList.remove('protected-view');
      if (warningTimer.current) clearTimeout(warningTimer.current);
    };
  }, [enabled, label, report]);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <div className={obscured ? 'pointer-events-none h-full w-full blur-2xl' : 'h-full w-full'}>{children}</div>

      {watermark && <Watermark label={label} />}

      {obscured && (
        <div className="absolute inset-0 z-[80] flex flex-col items-center justify-center gap-2 bg-[#090b10]/95 text-center">
          <ShieldAlert className="h-8 w-8 text-amber-400" />
          <p className="text-sm font-medium text-zinc-100">Protected view paused</p>
          <p className="max-w-xs text-xs text-zinc-500">
            The design is hidden while this window is not in focus. Click here to carry on viewing.
          </p>
        </div>
      )}

      {warning && (
        <div className="absolute left-1/2 top-4 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 backdrop-blur">
          <ShieldAlert className="h-4 w-4" />
          {warning}
        </div>
      )}
    </div>
  );
}

/**
 * Tiled, semi-transparent identity stamp. It sits above the canvas and takes
 * no pointer events, so it lands in any screenshot of the page without
 * getting in the way of looking at the design.
 */
function Watermark({ label }: { label: string }) {
  const stamp = React.useMemo(() => {
    const when = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return `${label} · ${when}`;
  }, [label]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[70] select-none overflow-hidden"
      style={{ contain: 'strict' }}
    >
      {Array.from({ length: 7 }).map((_, row) => (
        <div
          key={row}
          className="absolute whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.3em] text-white/[0.055]"
          style={{ top: `${row * 15 + 4}%`, left: '-10%', transform: 'rotate(-24deg)' }}
        >
          {Array.from({ length: 6 })
            .map(() => stamp)
            .join('    •    ')}
        </div>
      ))}
    </div>
  );
}
