'use client';

import * as React from 'react';
import { FileText, PencilRuler, Download, Loader2, Stamp } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useEditorStore } from '@/stores/editor-store';
import { useSessionStore } from '@/stores/session-store';
import { exportProjectPdf, type PaperSize } from '@/lib/export/pdf';
import { exportProjectDxf } from '@/lib/export/dxf';
import { captureImage, hasImageCapturer } from '@/lib/capture';
import { slugify } from '@/lib/storage';
import { cn } from '@/lib/cn';

export type ExportFormat = 'pdf' | 'dxf';

/**
 * Drawing exports: a PDF set (one page per floor, title block, area schedule,
 * optional 3D view page) and a DXF for CAD, each with or without a watermark.
 * Everything is generated in the browser from the model; nothing is uploaded.
 */
export function ExportDialog({ open, format, onClose }: { open: boolean; format: ExportFormat; onClose: () => void }) {
  const project = useEditorStore((s) => s.project);
  const activeFloorId = useEditorStore((s) => s.activeFloorId);
  const pushToast = useEditorStore((s) => s.pushToast);
  const account = useSessionStore((s) => (s.session?.kind === 'account' ? s.session : null));

  const [scope, setScope] = React.useState<'active' | 'all'>('all');
  const [watermark, setWatermark] = React.useState(true);
  const [watermarkText, setWatermarkText] = React.useState('');
  const [paper, setPaper] = React.useState<PaperSize>('A4');
  const [furniture, setFurniture] = React.useState(true);
  const [roomLabels, setRoomLabels] = React.useState(true);
  const [snapshot, setSnapshot] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const canSnapshot = hasImageCapturer();

  React.useEffect(() => {
    if (open && !watermarkText) {
      setWatermarkText(`${account?.name ? account.name + ' · ' : ''}${project.name} · ${new Date().toLocaleDateString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const floors = scope === 'all' ? project.floors : project.floors.filter((f) => f.id === activeFloorId);
  const stampText = watermark ? watermarkText.trim() || 'PREVIEW' : null;

  const download = async () => {
    setBusy(true);
    try {
      const base = `${slugify(project.name)}-${scope === 'all' ? 'floor-plans' : slugify(floors[0]?.name ?? 'floor')}${watermark ? '-watermarked' : ''}`;
      if (format === 'pdf') {
        let shot: { jpegBase64: string; width: number; height: number } | null = null;
        if (snapshot && canSnapshot) {
          const img = await captureImage('image/jpeg', 0.88);
          if (img) shot = { jpegBase64: img.dataUrl.replace(/^data:[^,]*,/, ''), width: img.width, height: img.height };
        }
        const bytes = exportProjectPdf(project, { floors, paper, watermark: stampText, furniture, snapshot: shot, author: account?.name });
        save(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${base}.pdf`);
      } else {
        const text = exportProjectDxf(project, { floors, watermark: stampText, furniture, roomLabels });
        save(new Blob([text], { type: 'application/dxf' }), `${base}.dxf`);
      }
      pushToast(`${format === 'pdf' ? 'PDF' : 'DXF'} exported${watermark ? ' with watermark' : ''}`, 'success');
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={format === 'pdf' ? 'Export PDF drawing' : 'Export 2D CAD drawing (DXF)'} width="max-w-lg">
      <div className="space-y-4 text-xs">
        <p className="flex items-start gap-2 text-zinc-400">
          {format === 'pdf' ? <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" /> : <PencilRuler className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />}
          {format === 'pdf'
            ? 'A to-scale drawing set: one page per floor with walls, doors and their swings, windows, rooms with areas, furniture, overall dimensions, a north arrow, a title block and an area schedule.'
            : 'A DXF (AutoCAD R12) that opens in AutoCAD, LibreCAD, QCAD, DraftSight, FreeCAD and Revit. Metres, with WALLS, DOORS, WINDOWS, ROOMS, FURNITURE, TEXT, DIMENSIONS and WATERMARK layers.'}
        </p>

        <Field label="Floors">
          <Seg
            value={scope}
            onChange={setScope}
            options={[
              ['all', `All floors (${project.floors.length})`],
              ['active', `Active floor only`],
            ]}
          />
        </Field>

        <Field label="Watermark">
          <Seg
            value={watermark ? 'on' : 'off'}
            onChange={(v) => setWatermark(v === 'on')}
            options={[
              ['on', 'With watermark'],
              ['off', 'Without watermark'],
            ]}
          />
          {watermark && (
            <div className="mt-2 flex items-center gap-2">
              <Stamp className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <input
                value={watermarkText}
                onChange={(e) => setWatermarkText(e.target.value)}
                placeholder="Text repeated across every page"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-sky-500/60"
              />
            </div>
          )}
          <p className="mt-1 text-[10px] text-zinc-500">
            {watermark ? 'Stamped diagonally across the drawing and noted in the title block as a preview, not for construction.' : 'Clean drawing for issue to a contractor or a CAD workflow.'}
          </p>
        </Field>

        {format === 'pdf' ? (
          <>
            <Field label="Paper">
              <Seg
                value={paper}
                onChange={setPaper}
                options={[
                  ['A4', 'A4 landscape'],
                  ['A3', 'A3 landscape'],
                  ['Letter', 'Letter'],
                ]}
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
              <input type="checkbox" checked={furniture} onChange={(e) => setFurniture(e.target.checked)} className="accent-sky-500" /> Include furniture outlines and names
            </label>
            <label className={cn('flex cursor-pointer items-center gap-2 text-zinc-300', !canSnapshot && 'opacity-50')}>
              <input type="checkbox" checked={snapshot && canSnapshot} disabled={!canSnapshot} onChange={(e) => setSnapshot(e.target.checked)} className="accent-sky-500" />
              Add a page with the current 3D view {canSnapshot ? '' : '(open the 3D view first)'}
            </label>
          </>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
              <input type="checkbox" checked={furniture} onChange={(e) => setFurniture(e.target.checked)} className="accent-sky-500" /> Include furniture (FURNITURE layer)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
              <input type="checkbox" checked={roomLabels} onChange={(e) => setRoomLabels(e.target.checked)} className="accent-sky-500" /> Room names and areas (TEXT layer)
            </label>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
            Cancel
          </button>
          <button onClick={() => void download()} disabled={busy || floors.length === 0} className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download {format.toUpperCase()}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function Field({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={cn('rounded-full border px-2.5 py-1 text-[11px]', value === v ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700')}>
          {label}
        </button>
      ))}
    </div>
  );
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
