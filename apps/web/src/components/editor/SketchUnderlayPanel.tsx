'use client';

import * as React from 'react';
import { Image as ImageIcon, Eye, EyeOff, Lock, Unlock, Trash2, Crosshair, Ruler, Box } from 'lucide-react';
import type { SketchUnderlay } from '@interior/core';
import { useEditorStore, useActiveFloor } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/cn';

/**
 * Paper first, pixels second.
 *
 * Most plans start as a sketch on paper. This imports a photo or scan of it,
 * lays it under the floor plan at a known scale, and lets you trace walls and
 * rooms over it. The image is stored in the project (as a data URL), scaled
 * down on import so it does not bloat the save, and positioned in plan metres
 * so it lines up again on any device.
 */
const MAX_EDGE_PX = 1800;
const DEFAULT_WIDTH_M = 10;

export function SketchUnderlayPanel() {
  const floor = useActiveFloor();
  const run = useEditorStore((s) => s.run);
  const pushToast = useEditorStore((s) => s.pushToast);
  const measure = useUiStore((s) => s.measureWidget);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [realLength, setRealLength] = React.useState('');
  const underlay = floor?.underlay ?? null;

  const save = (patch: Partial<SketchUnderlay>, label = 'Edit sketch') => {
    if (!floor || !underlay) return;
    run({ type: 'UPDATE_FLOOR', id: floor.id, patch: { underlay: { ...underlay, ...patch } } }, label);
  };

  const importFile = async (file: File | undefined) => {
    if (!file || !floor) return;
    setBusy(true);
    try {
      const { src, aspect } = await loadAndShrink(file);
      // Drop it under the middle of the current view at a sensible size.
      const cam = useEditorStore.getState().editor2D?.camera ?? { x: 0, y: 0, scale: 80 };
      const width = DEFAULT_WIDTH_M;
      const next: SketchUnderlay = {
        src,
        x: round3(cam.x - width / 2),
        y: round3(cam.y - (width * aspect) / 2),
        width,
        aspect,
        rotation: 0,
        opacity: 0.5,
        visible: true,
        locked: false,
        show3d: false,
      };
      run({ type: 'UPDATE_FLOOR', id: floor.id, patch: { underlay: next } }, 'Import sketch');
      pushToast('Sketch imported — drag it into place, set its width, then trace over it', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not read that image', 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /**
   * Scale calibration: measure a known length on the sketch with the Measure
   * tool, type the real distance, and the sketch is rescaled about the
   * measured segment's midpoint so what you measured stays where it is.
   */
  const measured = measure.from && measure.to ? Math.hypot(measure.to.x - measure.from.x, measure.to.y - measure.from.y) : 0;
  const calibrate = () => {
    if (!underlay || !measure.from || !measure.to || measured < 1e-3) return;
    const real = parseFloat(realLength);
    if (!Number.isFinite(real) || real <= 0) {
      pushToast('Enter the real length of what you measured', 'info');
      return;
    }
    const k = real / measured;
    const mid = { x: (measure.from.x + measure.to.x) / 2, y: (measure.from.y + measure.to.y) / 2 };
    save(
      {
        width: round3(underlay.width * k),
        x: round3(mid.x + (underlay.x - mid.x) * k),
        y: round3(mid.y + (underlay.y - mid.y) * k),
      },
      'Calibrate sketch scale',
    );
    pushToast(`Sketch scaled ×${k.toFixed(3)}`, 'success');
  };

  const centerInView = () => {
    if (!underlay) return;
    const cam = useEditorStore.getState().editor2D?.camera ?? { x: 0, y: 0, scale: 80 };
    save({ x: round3(cam.x - underlay.width / 2), y: round3(cam.y - (underlay.width * underlay.aspect) / 2) }, 'Centre sketch');
  };

  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-1.5 font-medium text-zinc-300">
        <ImageIcon className="h-3.5 w-3.5 text-zinc-500" /> Paper sketch
      </h4>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />

      {!underlay ? (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-700 bg-zinc-900/60 px-2 py-3 text-[11px] text-zinc-200 hover:border-sky-500/50 disabled:opacity-60"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {busy ? 'Reading image…' : 'Import a sketch or photo…'}
          </button>
          <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
            Photograph your hand-drawn plan, import it here and trace walls, doors and rooms over it. Lower its opacity so your lines stay readable.
          </p>
        </>
      ) : (
        <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="flex items-center gap-1">
            <img src={underlay.src} alt="" className="h-9 w-9 rounded border border-zinc-800 object-cover" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
              {underlay.width.toFixed(2)} × {(underlay.width * underlay.aspect).toFixed(2)} m
            </span>
            <IconToggle on={underlay.visible} onClick={() => save({ visible: !underlay.visible }, underlay.visible ? 'Hide sketch' : 'Show sketch')} onIcon={<Eye className="h-3.5 w-3.5" />} offIcon={<EyeOff className="h-3.5 w-3.5" />} title={underlay.visible ? 'Hide sketch' : 'Show sketch'} />
            <IconToggle on={underlay.locked} onClick={() => save({ locked: !underlay.locked }, underlay.locked ? 'Unlock sketch' : 'Lock sketch')} onIcon={<Lock className="h-3.5 w-3.5" />} offIcon={<Unlock className="h-3.5 w-3.5" />} title={underlay.locked ? 'Unlock: allow dragging in the plan' : 'Lock in place'} />
            <button
              onClick={() => floor && run({ type: 'UPDATE_FLOOR', id: floor.id, patch: { underlay: null } }, 'Remove sketch')}
              className="rounded p-1 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
              title="Remove sketch"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <Field label={`Opacity · ${Math.round(underlay.opacity * 100)}%`}>
            <input type="range" min={0.05} max={1} step={0.05} value={underlay.opacity} onChange={(e) => save({ opacity: parseFloat(e.target.value) })} className="w-full accent-sky-500" />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Width (m)">
              <NumberInput value={underlay.width} min={0.2} step={0.1} onChange={(v) => save({ width: v }, 'Resize sketch')} />
            </Field>
            <Field label="Rotation (°)">
              <NumberInput value={underlay.rotation} min={-180} max={180} step={1} onChange={(v) => save({ rotation: v }, 'Rotate sketch')} />
            </Field>
            <Field label="X (m)">
              <NumberInput value={underlay.x} step={0.1} onChange={(v) => save({ x: v }, 'Move sketch')} />
            </Field>
            <Field label="Y (m)">
              <NumberInput value={underlay.y} step={0.1} onChange={(v) => save({ y: v }, 'Move sketch')} />
            </Field>
          </div>

          <div className="flex items-center gap-1">
            <button onClick={centerInView} className="flex flex-1 items-center justify-center gap-1 rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:border-zinc-600" title="Move the sketch to the middle of the current view">
              <Crosshair className="h-3 w-3" /> Centre in view
            </button>
            <button
              onClick={() => save({ show3d: !underlay.show3d }, underlay.show3d ? 'Hide sketch in 3D' : 'Show sketch in 3D')}
              className={cn('flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1 text-[10px]', underlay.show3d ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-zinc-800 text-zinc-300 hover:border-zinc-600')}
              title="Also lay the sketch on the floor in the 3D view"
            >
              <Box className="h-3 w-3" /> {underlay.show3d ? 'Shown in 3D' : 'Show in 3D'}
            </button>
            <button onClick={() => fileRef.current?.click()} className="rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:border-zinc-600" title="Replace the image">
              Replace…
            </button>
          </div>

          <div className="rounded border border-zinc-800/80 bg-zinc-950/40 p-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-zinc-300">
              <Ruler className="h-3 w-3 text-zinc-500" /> Set the scale
            </div>
            <p className="text-[10px] leading-relaxed text-zinc-500">
              Press <kbd className="rounded bg-zinc-800 px-1">M</kbd> and measure something on the sketch whose real length you know (a wall, a door), then enter that length.
            </p>
            <div className="mt-1.5 flex items-center gap-1">
              <span className="w-20 shrink-0 text-[10px] text-zinc-500">{measured > 0 ? `${measured.toFixed(2)} m on screen =` : 'Nothing measured'}</span>
              <input
                value={realLength}
                onChange={(e) => setRealLength(e.target.value)}
                placeholder="real m"
                disabled={measured <= 0}
                className="w-16 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-sky-500/50 disabled:opacity-50"
              />
              <button onClick={calibrate} disabled={measured <= 0} className="rounded bg-sky-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40">
                Apply
              </button>
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-500">
            {underlay.locked ? 'Locked. Unlock to drag it in the plan.' : 'Drag the sketch in the plan to move it (with the Select tool, on an empty spot).'}
          </p>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    if (Number.isFinite(n)) onChange(round3(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))));
    setDraft(null);
  };
  return (
    <input
      type="number"
      value={draft ?? String(round3(value))}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
      className="w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-sky-500/50"
    />
  );
}

function IconToggle({ on, onClick, onIcon, offIcon, title }: { on: boolean; onClick: () => void; onIcon: React.ReactNode; offIcon: React.ReactNode; title: string }) {
  return (
    <button onClick={onClick} title={title} className={cn('rounded p-1 hover:bg-zinc-800', on ? 'text-sky-300' : 'text-zinc-500')}>
      {on ? onIcon : offIcon}
    </button>
  );
}

/** Decodes the file and shrinks it so the project stays small enough for localStorage. */
async function loadAndShrink(file: File): Promise<{ src: string; aspect: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (photo, PNG or JPEG).');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('That image could not be decoded.'));
    i.src = dataUrl;
  });
  const aspect = img.naturalHeight / Math.max(img.naturalWidth, 1);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale >= 1 && dataUrl.length < 900_000) return { src: dataUrl, aspect };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { src: dataUrl, aspect };
  // A white backing keeps transparent PNG scans readable at low opacity.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { src: canvas.toDataURL('image/jpeg', 0.82), aspect };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
