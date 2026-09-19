import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800/80">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center justify-between gap-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
      >
        {title}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function Row({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-2 py-[3px]', className)}>
      {label && <span className="truncate text-xs text-zinc-400">{label}</span>}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">{children}</div>
    </div>
  );
}

/**
 * Range input that commits once per gesture rather than on every pixel of a
 * drag (which would push dozens of undo entries). Keyboard nudges and a blur
 * also commit — previously only pointer-up did, so arrow-key changes were
 * shown but never applied.
 */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  suffix,
  className,
  digits,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
  className?: string;
  /** Decimal places for the readout; defaults from `step`. */
  digits?: number;
}) {
  const [draft, setDraft] = React.useState<number | null>(null);
  const shown = draft ?? value;
  const places = digits ?? (step < 0.1 ? 2 : step < 1 ? 1 : 0);

  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft);
    setDraft(null);
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded bg-zinc-700 accent-sky-500"
      />
      <span className="w-16 shrink-0 text-right font-mono2 text-[11px] text-zinc-300">
        {shown.toFixed(places)}
        {suffix}
      </span>
    </div>
  );
}

const HEX_RE = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;

export function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  // <input type="color"> only accepts #rrggbb; anything else (rgba(), names)
  // is reported as an error and renders black, so normalise for the input
  // while still swatching the raw value.
  const inputValue = HEX_RE.test(value) ? expandHex(value) : '#888888';
  return (
    <div className="flex items-center gap-1.5">
      <label className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded border border-zinc-600">
        <input
          type="color"
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-8 w-8 cursor-pointer opacity-0"
        />
        <span className="absolute inset-0" style={{ backgroundColor: value }} />
      </label>
      <span className="uppercase text-[11px] text-zinc-300">{HEX_RE.test(value) ? value.replace('#', '') : 'custom'}</span>
    </div>
  );
}

function expandHex(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length === 3) return '#' + clean.split('').map((c) => c + c).join('');
  return '#' + clean.toLowerCase();
}

export function SwatchRow({ swatches, value, onChange }: { swatches: string[]; value: string | null; onChange: (hex: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {swatches.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c.toUpperCase()}
          style={{ backgroundColor: c }}
          className={cn(
            'h-5 w-5 rounded border transition-transform hover:scale-110',
            value?.toLowerCase() === c.toLowerCase() ? 'border-sky-400 ring-1 ring-sky-400/50' : 'border-zinc-600',
          )}
        />
      ))}
    </div>
  );
}
