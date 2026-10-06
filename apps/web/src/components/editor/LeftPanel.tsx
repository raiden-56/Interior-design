'use client';

import * as React from 'react';
import { Search, Armchair, PencilRuler, Palette, X, Grid3x3, DoorOpen, MousePointer2 } from 'lucide-react';
import type { Command } from '@interior/core';
import { useEditorStore } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';
import { FURNITURE_LIBRARY, FURNITURE_CATEGORIES, searchAssets, type FurnitureCategory } from '@/lib/furniture';
import { MATERIALS } from '@/lib/materials';
import { cn } from '@/lib/cn';
import { SketchUnderlayPanel } from './SketchUnderlayPanel';

export function LeftPanel() {
  const tab = useUiStore((s) => s.leftTab);
  const setTab = useUiStore((s) => s.setLeftTab);
  const toggleLeft = useUiStore((s) => s.toggleLeft);

  return (
    <aside data-tour="left-panel" className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-[#0d1016]">
      <div className="flex items-center justify-between border-b border-zinc-800/70 px-2 py-2">
        <div className="flex items-center gap-1">
          <span data-tour="tab-furniture">
            <TabBtn active={tab === 'furniture'} onClick={() => setTab('furniture')} icon={<Armchair className="h-3.5 w-3.5" />} label="Furniture" />
          </span>
          <span data-tour="tab-structure">
            <TabBtn active={tab === 'walls'} onClick={() => setTab('walls')} icon={<PencilRuler className="h-3.5 w-3.5" />} label="Structure" />
          </span>
          <span data-tour="tab-materials">
            <TabBtn active={tab === 'materials'} onClick={() => setTab('materials')} icon={<Palette className="h-3.5 w-3.5" />} label="Materials" />
          </span>
        </div>
        <button onClick={toggleLeft} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="Hide panel">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'furniture' && <FurnitureTab />}
        {tab === 'walls' && <WallsTab />}
        {tab === 'materials' && <MaterialsTab />}
      </div>
    </aside>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
        active && 'bg-zinc-800 text-sky-400',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function FurnitureTab() {
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<FurnitureCategory | null>(null);
  const view = useEditorStore((s) => s.view);
  const pushToast = useEditorStore((s) => s.pushToast);
  const items = React.useMemo(
    () => searchAssets(query, category),
    [query, category],
  );

  const pick = (asset: (typeof FURNITURE_LIBRARY)[number]) => {
    useUiStore.getState().setPendingAsset({
      assetId: asset.id,
      name: asset.name,
      shape: asset.shape,
      width: asset.width,
      depth: asset.depth,
      height: asset.height,
      color: asset.color,
      mounted: asset.mounted,
    });
    useEditorStore.getState().setTool('select');
    pushToast(`${view === '3d' ? 'Click in the 3D view' : 'Click on the floor plan'} to place ${asset.name}`, 'info');
  };

  return (
    <div className="p-2">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search furniture…"
          className="w-full rounded-md border border-zinc-800 bg-zinc-900/70 py-1.5 pl-7 pr-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-sky-500/50"
        />
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        <button
          onClick={() => setCategory(null)}
          className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium text-zinc-400 hover:bg-zinc-800', !category && 'bg-sky-600/20 text-sky-300')}
        >
          All
        </button>
        {FURNITURE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(category === c.id ? null : c.id)}
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium text-zinc-400 hover:bg-zinc-800',
              category === c.id && 'bg-sky-600/20 text-sky-300',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
        Click an item, then click on the canvas to place it. You can also ask the AI assistant to furnish the space for you.
      </p>
      <div data-tour="furniture-grid" className="grid grid-cols-2 gap-2">
        {items.map((a) => (
          <button
            key={a.id}
            onClick={() => pick(a)}
            className="group flex flex-col items-center gap-1 rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-2 py-2.5 text-center hover:border-sky-500/40 hover:bg-zinc-800/60"
          >
            <div
              className="h-9 w-9 rounded-md shadow-inner transition-transform group-hover:scale-105"
              style={{ backgroundColor: a.color, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }}
            />
            <div className="text-[10px] font-medium leading-tight text-zinc-300">{a.name}</div>
            <div className="text-[9px] text-zinc-500">
              {(a.width * 100).toFixed(0)}×{(a.depth * 100).toFixed(0)}
              {a.mounted && <span className="ml-1 text-sky-400/80">wall</span>}
            </div>
          </button>
        ))}
        {items.length === 0 && <div className="col-span-2 py-8 text-center text-xs text-zinc-500">No furniture found</div>}
      </div>
    </div>
  );
}

function WallsTab() {
  const run = useEditorStore((s) => s.run);
  const setTool = useEditorStore((s) => s.setTool);
  const tool = useEditorStore((s) => s.tool);
  const pushToast = useEditorStore((s) => s.pushToast);

  const addRectRoom = (w: number, d: number) => {
    const id = (p: string) => `wall-${p}-${Math.random().toString(36).slice(2, 8)}`;
    // Place the new room just to the right of whatever is already drawn, so
    // adding a second quick room doesn't stack it on top of the first.
    const { project, activeFloorId } = useEditorStore.getState();
    const floor = project.floors.find((f) => f.id === activeFloorId) ?? project.floors[0];
    const xs = floor.walls.flatMap((wl) => [wl.a.x, wl.b.x]);
    const ys = floor.walls.flatMap((wl) => [wl.a.y, wl.b.y]);
    const ox = xs.length ? Math.max(...xs) + 1 : 0;
    const oy = ys.length ? Math.min(...ys) : 0;
    const height = floor.height;
    const wall = (p: string, a: { x: number; y: number }, b: { x: number; y: number }) => ({
      type: 'ADD_WALL' as const,
      wall: { id: id(p), a: { x: ox + a.x, y: oy + a.y }, b: { x: ox + b.x, y: oy + b.y }, thickness: 0.14, height, color: '#e8e6e1', materialId: null },
    });
    run({
      type: 'BATCH',
      label: 'Add rectangular room',
      commands: [
        wall('a', { x: 0, y: 0 }, { x: w, y: 0 }),
        wall('b', { x: w, y: 0 }, { x: w, y: d }),
        wall('c', { x: w, y: d }, { x: 0, y: d }),
        wall('d', { x: 0, y: d }, { x: 0, y: 0 }),
        {
          type: 'ADD_ROOM' as const,
          room: {
            id: `room-${Math.random().toString(36).slice(2, 8)}`,
            name: `Room ${floor.rooms.length + 1}`,
            points: [{ x: ox, y: oy }, { x: ox + w, y: oy }, { x: ox + w, y: oy + d }, { x: ox, y: oy + d }],
            color: '#4a68a6',
            materialId: null,
          },
        },
      ],
    });
    useEditorStore.getState().editor2D?.fitView();
    pushToast(`Added ${w}×${d} m room`, 'success');
  };

  return (
    <div className="space-y-4 p-3 text-xs">
      <SketchUnderlayPanel />

      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 font-medium text-zinc-300">
          <Grid3x3 className="h-3.5 w-3.5 text-zinc-500" /> Quick room
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => addRectRoom(3, 4)} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2.5 text-[11px] hover:border-sky-500/40">
            3×4 m
          </button>
          <button onClick={() => addRectRoom(4, 5)} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2.5 text-[11px] hover:border-sky-500/40">
            4×5 m
          </button>
          <button onClick={() => addRectRoom(5, 6)} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2.5 text-[11px] hover:border-sky-500/40">
            5×6 m
          </button>
          <button onClick={() => addRectRoom(6, 8)} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2.5 text-[11px] hover:border-sky-500/40">
            6×8 m
          </button>
        </div>
      </section>

      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 font-medium text-zinc-300">
          <MousePointer2 className="h-3.5 w-3.5 text-zinc-500" /> Drawing tools
        </h4>
        <div className="space-y-1.5">
          <ToolRow
            active={tool === 'wall'}
            onClick={() => setTool('wall')}
            label="Wall"
            hint="Click to start, click each corner, Enter to finish"
          />
          <ToolRow
            active={tool === 'door'}
            onClick={() => setTool('door')}
            label="Door"
            hint="Click a wall to insert a door"
          />
          <ToolRow
            active={tool === 'window'}
            onClick={() => setTool('window')}
            label="Window"
            hint="Click a wall to insert a window"
          />
          <ToolRow
            active={tool === 'room'}
            onClick={() => setTool('room')}
            label="Room"
            hint="Click each corner, right-click or Enter to close"
          />
        </div>
      </section>
    </div>
  );
}

function ToolRow({ active, onClick, label, hint }: { active: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-md border px-3 py-2 text-left',
        active ? 'border-sky-500/50 bg-sky-500/10' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
      )}
    >
      <span className="flex items-center gap-1.5 font-medium text-zinc-200">
        {active && <DoorOpen className="h-3 w-3 text-sky-400" />}
        {label}
      </span>
      <span className="mt-0.5 block text-[10px] text-zinc-500">{hint}</span>
    </button>
  );
}

function MaterialsTab() {
  const selection = useEditorStore((s) => s.selection);
  const run = useEditorStore((s) => s.run);
  const pushToast = useEditorStore((s) => s.pushToast);

  /**
   * Applies a library material to whatever is selected.
   *
   * This used to fire UPDATE_OBJECT *and* UPDATE_WALL *and* UPDATE_ROOM for
   * every selected id, so two of the three always targeted something that
   * did not exist; those no-ops still landed in the undo history with the
   * original command as their own inverse. It also set only the colour, which
   * left the material dropdown in the properties panel reading "custom" and
   * threw away the finish (roughness/metalness) entirely.
   */
  const applyMaterial = (materialId: string, color: string) => {
    if (selection.length === 0) {
      pushToast('Select a wall, room or object first', 'info');
      return;
    }
    const { project, activeFloorId } = useEditorStore.getState();
    const floor = project.floors.find((f) => f.id === activeFloorId) ?? project.floors[0];
    const patch = { color, materialId };

    const commands: Command[] = selection.flatMap((id): Command[] => {
      if (floor.objects.some((o) => o.id === id)) return [{ type: 'UPDATE_OBJECT', id, patch }];
      if (floor.walls.some((w) => w.id === id)) return [{ type: 'UPDATE_WALL', id, patch }];
      if (floor.rooms.some((r) => r.id === id)) return [{ type: 'UPDATE_ROOM', id, patch }];
      return [];
    });

    if (commands.length === 0) {
      pushToast('Materials apply to walls, rooms and furniture', 'info');
      return;
    }
    run({ type: 'BATCH', label: 'Apply material', commands });
  };

  return (
    <div className="space-y-4 p-3">
      <section>
        <h4 className="mb-2 font-medium text-zinc-300">Material library</h4>
        <div className="grid grid-cols-2 gap-2">
          {MATERIALS.map((m) => (
            <button
              key={m.id}
              onClick={() => applyMaterial(m.id, m.color)}
              className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-2 text-left hover:border-sky-500/40"
            >
              <span className="h-6 w-6 rounded-md shadow-inner" style={{ backgroundColor: m.color, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }} />
              <span>
                <span className="block text-[11px] text-zinc-200">{m.name}</span>
                <span className="block text-[9px] text-zinc-500">{m.category}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        Click a material to apply it to the current selection — colour and finish together. Per-item colour and
        material controls live in the right-hand properties panel.
      </p>
    </div>
  );
}