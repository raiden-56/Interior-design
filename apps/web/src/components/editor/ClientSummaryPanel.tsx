'use client';

import * as React from 'react';
import { Home, Ruler, Sofa, Layers, DoorOpen, PanelTop } from 'lucide-react';
import { polygonArea } from '@interior/core';
import { useEditorStore, useActiveFloor } from '@/stores/editor-store';
import { SQM_TO_SQFT } from '@/lib/templates';

/**
 * What a client gets instead of the property editor: the schedule of the
 * design they are looking at. Areas per room, what is in each of them, and
 * the totals — the questions a client actually asks on a walkthrough call,
 * answered without handing over a single editable control.
 */
export function ClientSummaryPanel() {
  const project = useEditorStore((s) => s.project);
  const floor = useActiveFloor();
  const selection = useEditorStore((s) => s.selection);

  const rooms = React.useMemo(
    () =>
      floor.rooms
        .map((r) => ({ id: r.id, name: r.name, area: Math.abs(polygonArea(r.points)), color: r.color }))
        .sort((a, b) => b.area - a.area),
    [floor.rooms],
  );

  const totalArea = rooms.reduce((sum, r) => sum + r.area, 0);

  const byCategory = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of floor.objects) counts.set(o.name, (counts.get(o.name) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [floor.objects]);

  const selected = selection.length === 1 ? floor.objects.find((o) => o.id === selection[0]) : undefined;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-800 bg-[#0d1016]">
      <div className="border-b border-zinc-800/70 px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Home className="h-3.5 w-3.5" /> Design summary
        </h2>
        <p className="mt-0.5 truncate text-[11px] text-zinc-500">{project.name}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          <Metric icon={<Ruler className="h-3.5 w-3.5" />} label="Carpet area" value={`${totalArea.toFixed(1)} m²`} sub={`${Math.round(totalArea * SQM_TO_SQFT)} sq ft`} />
          <Metric icon={<Layers className="h-3.5 w-3.5" />} label="Rooms" value={String(rooms.length)} sub={`${project.floors.length} floor${project.floors.length > 1 ? 's' : ''}`} />
          <Metric icon={<Sofa className="h-3.5 w-3.5" />} label="Furniture" value={String(floor.objects.length)} sub="pieces placed" />
          <Metric
            icon={<DoorOpen className="h-3.5 w-3.5" />}
            label="Openings"
            value={String(floor.doors.length + floor.windows.length)}
            sub={`${floor.doors.length} doors · ${floor.windows.length} windows`}
          />
        </div>

        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Rooms</h3>
          <ul className="space-y-1">
            {rooms.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-2 py-1.5 text-[11px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: r.color }} />
                <span className="min-w-0 flex-1 truncate text-zinc-300">{r.name}</span>
                <span className="shrink-0 tabular-nums text-zinc-500">{r.area.toFixed(1)} m²</span>
              </li>
            ))}
            {rooms.length === 0 && <li className="px-1 py-2 text-[11px] text-zinc-600">No rooms drawn on this floor.</li>}
          </ul>
        </section>

        {selected && (
          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Selected item</h3>
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-2.5 py-2 text-[11px]">
              <div className="font-medium text-zinc-100">{selected.name}</div>
              <div className="mt-0.5 text-zinc-500">
                {(selected.width * 100).toFixed(0)} × {(selected.depth * 100).toFixed(0)} × {(selected.height * 100).toFixed(0)} cm
              </div>
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <PanelTop className="h-3 w-3" /> Furniture schedule
          </h3>
          <ul className="space-y-0.5">
            {byCategory.map(([name, count]) => (
              <li key={name} className="flex items-center justify-between gap-2 px-1 text-[11px] text-zinc-400">
                <span className="truncate">{name}</span>
                <span className="shrink-0 tabular-nums text-zinc-600">×{count}</span>
              </li>
            ))}
            {byCategory.length === 0 && <li className="px-1 text-[11px] text-zinc-600">Nothing placed yet.</li>}
          </ul>
        </section>
      </div>

      <p className="border-t border-zinc-800/70 px-3 py-2 text-[10px] leading-relaxed text-zinc-600">
        Read-only preview. Send your comments back to the architect — any change has to be made on their copy.
      </p>
    </aside>
  );
}

function Metric({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-zinc-100">{value}</div>
      <div className="text-[10px] text-zinc-600">{sub}</div>
    </div>
  );
}
