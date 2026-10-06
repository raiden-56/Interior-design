'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import type { WalkPrompt } from '@/stores/walkthrough-store';

/** The two-word prompt under the crosshair: `E  Sit`. */
export function InteractionPrompt({ prompt, highContrast }: { prompt: WalkPrompt | null; highContrast: boolean }) {
  if (!prompt) return null;
  return (
    <div className="pointer-events-none absolute bottom-[22%] left-1/2 z-20 -translate-x-1/2 select-none">
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs backdrop-blur transition-opacity',
          highContrast ? 'border border-white bg-black text-white' : 'border border-white/10 bg-black/55 text-zinc-100',
        )}
      >
        {prompt.key && !prompt.passive && (
          <kbd className={cn('rounded px-1.5 py-0.5 font-mono2 text-[11px] font-semibold', highContrast ? 'bg-white text-black' : 'bg-sky-500/90 text-white')}>
            {prompt.key}
          </kbd>
        )}
        <span className={cn(prompt.passive && 'text-zinc-300')}>{prompt.text}</span>
      </div>
    </div>
  );
}

/** Minimal centre mark; becomes a dot when something can be used. */
export function Crosshair({ active, highContrast }: { active: boolean; highContrast: boolean }) {
  const color = highContrast ? 'bg-white' : 'bg-white/80';
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2" aria-hidden>
      {active ? (
        <div className={cn('h-2 w-2 rounded-full ring-2 ring-black/30', highContrast ? 'bg-white' : 'bg-sky-300')} />
      ) : (
        <div className="relative h-4 w-4">
          <span className={cn('absolute left-1/2 top-0 h-full w-px -translate-x-1/2', color)} style={{ boxShadow: '0 0 2px rgba(0,0,0,0.8)' }} />
          <span className={cn('absolute top-1/2 left-0 h-px w-full -translate-y-1/2', color)} style={{ boxShadow: '0 0 2px rgba(0,0,0,0.8)' }} />
        </div>
      )}
    </div>
  );
}
