'use client';

import * as React from 'react';
import { MousePointer2, PencilRuler, DoorOpen, Grid3x3, Ruler, Hand, Plus, Trash2, Focus, Crosshair, Eye, EyeOff } from 'lucide-react';
import { useEditorStore } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/cn';
import type { PlanTool } from '@/lib/plan-types';

const TOOLS: { id: PlanTool; label: string; icon: React.ReactNode; key: string }[] = [
  { id: 'select', label: 'Select', icon: <MousePointer2 className="h-4 w-4" />, key: 'V' },
  { id: 'wall', label: 'Wall', icon: <PencilRuler className="h-4 w-4" />, key: 'B' },
  { id: 'door', label: 'Door', icon: <DoorOpen className="h-4 w-4" />, key: 'D' },
  { id: 'window', label: 'Window', icon: <Grid3x3 className="h-4 w-4" />, key: 'N' },
  { id: 'room', label: 'Room', icon: <Crosshair className="h-4 w-4" />, key: 'R' },
  { id: 'measure', label: 'Measure', icon: <Ruler className="h-4 w-4" />, key: 'M' },
  { id: 'pan', label: 'Pan', icon: <Hand className="h-4 w-4" />, key: 'H' },
];

export function BottomBar() {
  const project = useEditorStore((s) => s.project);
  const activeFloorId = useEditorStore((s) => s.activeFloorId);
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const addFloor = useEditorStore((s) => s.addFloor);
  const deleteFloor = useEditorStore((s) => s.deleteFloor);
  const setActiveFloor = useEditorStore((s) => s.setActiveFloor);
  const updateProjectInfo = useEditorStore((s) => s.updateProjectInfo);
  const toggleFloorVisible = useEditorStore((s) => s.toggleFloorVisible);
  const setView = useEditorStore((s) => s.setView);
  const view = useEditorStore((s) => s.view);
  const editor2D = useEditorStore((s) => s.editor2D);
  const warnings = useEditorStore((s) => s.warnings);
  const spaceHeld = useUiStore((s) => s.spaceHeld);

  const fit2D = () => editor2D?.fitView();

  return (
    <footer className="z-20 flex h-11 shrink-0 items-center gap-3 border-t border-zinc-800 bg-[#0d1016] px-3 text-xs">
      {/* Tools */}
      <div className="flex items-center gap-0.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            // Panning is the one tool that means something in 3D as well; the
            // drawing tools still need the floor plan.
            disabled={view === '3d' && t.id !== 'select' && t.id !== 'pan'}
            aria-pressed={spaceHeld ? t.id === 'pan' : tool === t.id}
            title={t.id === 'pan' ? 'Pan (H) — or hold Space with any tool' : `${t.label} (${t.key})`}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30',
              // Space temporarily overrides the active tool, so show that.
              (spaceHeld ? t.id === 'pan' : tool === t.id) && 'bg-sky-600/20 text-sky-300',
            )}
          >
            {t.icon}
            <span className="hidden lg:inline">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="h-5 w-px bg-zinc-800" />

      {/* 2D / 3D */}
      <div className="flex items-center overflow-hidden rounded-md border border-zinc-800">
        <button
          onClick={() => setView('2d')}
          className={cn('px-3 py-1.5 font-medium text-zinc-400', view === '2d' && 'bg-zinc-800 text-sky-300')}
        >
          2D
        </button>
        <button
          onClick={() => setView('3d')}
          className={cn('px-3 py-1.5 font-medium text-zinc-400', view === '3d' && 'bg-zinc-800 text-sky-300')}
        >
          3D
        </button>
      </div>

      {view === '2d' && (
        <button
          onClick={fit2D}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-zinc-400 hover:bg-zinc-800"
          title="Fit view to drawing"
        >
          <Focus className="h-4 w-4" />
          Fit
        </button>
      )}

      <div className="flex-1" />

      {/* Floors */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Floors</span>
        {project.floors.map((f) => (
          <span key={f.id} className="flex items-center overflow-hidden rounded-md">
            <button
              onClick={() => setActiveFloor(f.id)}
              className={cn(
                'rounded-l-md px-2.5 py-1 font-medium',
                activeFloorId === f.id ? 'bg-sky-600/25 text-sky-300' : 'text-zinc-400 hover:bg-zinc-800',
                !f.visible && 'line-through opacity-60',
              )}
            >
              {f.name}
            </button>
            {project.floors.length > 1 && (
              <button
                onClick={() => toggleFloorVisible(f.id)}
                title={f.visible ? 'Hide this floor in 3D' : 'Show this floor in 3D'}
                className={cn('rounded-r-md px-1 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200', activeFloorId === f.id && 'bg-sky-600/25')}
              >
                {f.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
            )}
          </span>
        ))}
        <button
          onClick={() => addFloor(`Floor ${project.floors.length + 1}`)}
          title="Add floor"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-emerald-400"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {project.floors.length > 1 && (
          <button
            onClick={() => deleteFloor(activeFloorId)}
            title="Remove active floor"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Units */}
      <div className="flex items-center gap-1">
        {(['meters', 'centimeters', 'feet'] as const).map((u) => (
          <button
            key={u}
            onClick={() => updateProjectInfo({ units: u })}
            className={cn(
              'rounded px-1.5 py-1 text-[11px] font-medium uppercase text-zinc-500 hover:text-zinc-200',
              project.units === u && 'text-sky-300',
            )}
          >
            {u === 'meters' ? 'm' : u === 'centimeters' ? 'cm' : 'ft'}
          </button>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300" title={warnings.join('\n')}>
          {warnings.length} warning{warnings.length > 1 ? 's' : ''}
        </div>
      )}

      <span className="text-zinc-600">{project.floors.filter((f) => f.id === activeFloorId)[0]?.objects.length ?? 0} objects</span>
    </footer>
  );
}