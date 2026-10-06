'use client';

import * as React from 'react';
import { X, RotateCcw, MapPin } from 'lucide-react';
import { useWalkthroughStore } from '@/stores/walkthrough-store';
import { useEditorStore } from '@/stores/editor-store';
import { useCan } from '@/stores/session-store';
import { cn } from '@/lib/cn';
import type { HeadBob, WalkSettings } from './WalkSettings';
import { getRuntime } from './runtime';
import { newSpawnId } from './SpawnPoint';

/** Motion, comfort and control settings. Everything persists per browser. */
export function WalkthroughSettings() {
  const s = useWalkthroughStore((st) => st.settings);
  const update = useWalkthroughStore((st) => st.updateSettings);
  const reset = useWalkthroughStore((st) => st.resetSettings);
  const close = () => useWalkthroughStore.getState().setSettingsOpen(false);
  const canEdit = useCan('edit');

  const setStartHere = () => {
    const rt = getRuntime();
    if (!rt) return;
    const snap = rt.snapshot();
    const store = useEditorStore.getState();
    const floor = store.project.floors.find((f) => f.id === snap.floorId);
    if (!floor) return;
    const wt = store.project.walkthrough ?? { spawns: [], startSpawnId: null };
    const id = newSpawnId();
    const spawn = { id, name: `Start ${wt.spawns.length + 1}`, floorId: floor.id, x: round2(snap.x), z: round2(snap.z), yaw: Math.round(snap.yaw * 1000) / 1000 };
    store.run({ type: 'UPDATE_PROJECT', patch: { walkthrough: { spawns: [...wt.spawns, spawn], startSpawnId: id } } }, 'Set walkthrough start');
    useWalkthroughStore.getState().setNotice('Walkthrough start saved here');
  };

  return (
    <Panel title="Walkthrough settings" onClose={close}>
      <Group title="Controls">
        <Range label="Mouse sensitivity" value={s.mouseSensitivity} min={0.2} max={3} step={0.05} onChange={(v) => update({ mouseSensitivity: v })} format={(v) => v.toFixed(2) + '×'} />
        <Toggle label="Invert Y" value={s.invertY} onChange={(v) => update({ invertY: v })} />
        <Toggle label="Sprint (Shift)" value={s.sprintEnabled} onChange={(v) => update({ sprintEnabled: v })} />
        <Toggle label="Jump (Space)" value={s.jumpEnabled} onChange={(v) => update({ jumpEnabled: v })} hint="Off by default: this is a design tool, not a game." />
        <Toggle label="Automatic doors" value={s.autoDoors} onChange={(v) => update({ autoDoors: v })} hint="Every manual door opens as you approach." />
      </Group>
      <Group title="Movement">
        <Range label="Walking speed" value={s.walkSpeed} min={0.6} max={2.6} step={0.1} onChange={(v) => update({ walkSpeed: v })} format={(v) => v.toFixed(1) + ' m/s'} />
        <Range label="Running speed" value={s.runSpeed} min={1.5} max={5} step={0.1} onChange={(v) => update({ runSpeed: v })} format={(v) => v.toFixed(1) + ' m/s'} />
        <Range label="Eye height" value={s.eyeHeight} min={1.2} max={1.95} step={0.01} onChange={(v) => update({ eyeHeight: v, playerHeight: Math.max(s.playerHeight, v + 0.08) })} format={(v) => v.toFixed(2) + ' m'} />
      </Group>
      <Group title="Camera & comfort">
        <Range label="Field of view" value={s.fov} min={55} max={95} step={1} onChange={(v) => update({ fov: v })} format={(v) => v.toFixed(0) + '°'} />
        <Range label="Camera smoothing" value={s.cameraSmoothing} min={0} max={1} step={0.05} onChange={(v) => update({ cameraSmoothing: v })} format={(v) => Math.round(v * 100) + '%'} />
        <Row label="Head bob">
          <div className="flex w-full items-center gap-1">
            {(['off', 'low', 'medium'] as HeadBob[]).map((h) => (
              <button
                key={h}
                onClick={() => update({ headBob: h })}
                className={cn('flex-1 rounded border px-2 py-1 text-[10px] capitalize', s.headBob === h ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300')}
              >
                {h}
              </button>
            ))}
          </div>
        </Row>
        <Toggle label="Reduced motion" value={s.reducedMotion} onChange={(v) => update({ reducedMotion: v })} hint="No head bob, shorter transitions." />
        <Toggle label="High-contrast prompts" value={s.highContrastPrompts} onChange={(v) => update({ highContrastPrompts: v })} />
        <Toggle label="Show control hints" value={s.showHints} onChange={(v) => update({ showHints: v })} />
      </Group>
      <div className="flex items-center justify-between gap-2 pt-1">
        {canEdit ? (
          <button onClick={setStartHere} className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-500/20">
            <MapPin className="h-3.5 w-3.5" /> Set walkthrough start here
          </button>
        ) : (
          <span />
        )}
        <button onClick={reset} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>
    </Panel>
  );
}

export function Panel({ title, onClose, children, width = 'w-80' }: React.PropsWithChildren<{ title: string; onClose: () => void; width?: string }>) {
  return (
    <div className={cn('pointer-events-auto max-h-[80vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0b0f16]/95 p-3 text-xs text-zinc-200 shadow-2xl backdrop-blur', width)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{title}</span>
        <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200" title="Close (Esc)">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

function Group({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-[11px] text-zinc-400">{label}</span>
      {children}
    </div>
  );
}

function Range({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <Row label={label}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full accent-sky-500" />
      <span className="w-14 shrink-0 text-right font-mono2 text-[10px] text-zinc-300">{format(value)}</span>
    </Row>
  );
}

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-sky-500" />
      <span>
        <span className="block text-[11px] text-zinc-300">{label}</span>
        {hint && <span className="block text-[10px] text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export type { WalkSettings };
