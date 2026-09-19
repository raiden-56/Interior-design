'use client';

import * as React from 'react';
import { ArrowRight, BedDouble, Bath, Sofa, Ruler, Check } from 'lucide-react';
import type { Project } from '@interior/core';
import { TEMPLATES, TEMPLATE_FILTERS, SQM_TO_SQFT, templateStats, type ProjectTemplate, type TemplateCategory } from '@/lib/templates';
import { PlanThumbnail } from '@/components/PlanThumbnail';
import { cn } from '@/lib/cn';

/**
 * Browse-and-compare gallery for the starter plans.
 *
 * Picking a starting point used to be four unlabelled cards with a one-line
 * description, which is not enough to choose between a 2 BHK and a 3 BHK. Here
 * every plan is measured from the model it will actually create — footprint,
 * carpet area, room-by-room areas, how many pieces of furniture come with it —
 * so the decision can be made before anything is created, and the plan opens
 * fully editable either way.
 */
export function TemplateGallery({ initialId, onPick }: { initialId?: string; onPick: (project: Project, template: ProjectTemplate) => void }) {
  const [filter, setFilter] = React.useState<TemplateCategory | 'all'>('all');
  const [selectedId, setSelectedId] = React.useState(initialId ?? TEMPLATES[1]?.id ?? TEMPLATES[0].id);

  // Building a template is a pure function over the catalog, so previews are
  // cheap — but memoised anyway since the detail pane re-renders on hover.
  const previews = React.useMemo(() => {
    const map = new Map<string, Project>();
    for (const t of TEMPLATES) map.set(t.id, t.build());
    return map;
  }, []);

  const visible = TEMPLATES.filter((t) => filter === 'all' || t.category === filter);
  const selected = TEMPLATES.find((t) => t.id === selectedId) ?? visible[0] ?? TEMPLATES[0];
  const selectedPreview = previews.get(selected.id);

  React.useEffect(() => {
    // Keep the detail pane in step when a filter hides the current selection.
    if (visible.length > 0 && !visible.some((t) => t.id === selectedId)) setSelectedId(visible[0].id);
  }, [filter, selectedId, visible]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="lg:w-[46%]">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TEMPLATE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
                filter === f.id && 'border-sky-500/50 bg-sky-500/10 text-sky-300',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {visible.map((t) => {
            const preview = previews.get(t.id);
            const stats = preview ? templateStats(preview) : null;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                onDoubleClick={() => preview && onPick(preview, t)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-2 text-left transition-colors hover:border-zinc-700',
                  selectedId === t.id && 'border-sky-500/60 bg-sky-500/5',
                )}
              >
                <div className="h-16 w-24 shrink-0 rounded-lg bg-[#0c0f14] p-1">
                  {preview && <PlanThumbnail project={preview} className="h-full w-full" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-100">{t.name}</span>
                    <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
                      {t.badge}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {stats && stats.carpetArea > 0
                      ? `${stats.footprint} · ${stats.carpetArea.toFixed(0)} m² · ${stats.objects} items`
                      : 'Empty floor — draw your own'}
                  </div>
                </div>
                {selectedId === t.id && <Check className="h-4 w-4 shrink-0 text-sky-400" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
        {selectedPreview && <TemplateDetail template={selected} project={selectedPreview} onPick={() => onPick(selectedPreview, selected)} />}
      </div>
    </div>
  );
}

function TemplateDetail({ template, project, onPick }: { template: ProjectTemplate; project: Project; onPick: () => void }) {
  const stats = templateStats(project);
  const empty = stats.carpetArea === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="rounded-lg bg-[#0c0f14] p-2">
        <PlanThumbnail project={project} detail className="h-56 w-full" />
      </div>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{template.name}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{template.description}</p>
        </div>
      </div>

      {!empty && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat icon={<Ruler className="h-3.5 w-3.5" />} label="Footprint" value={stats.footprint} />
          <Stat
            icon={<Ruler className="h-3.5 w-3.5" />}
            label="Carpet area"
            value={`${stats.carpetArea.toFixed(0)} m²`}
            sub={`${Math.round(stats.carpetArea * SQM_TO_SQFT)} sq ft`}
          />
          <Stat
            icon={<BedDouble className="h-3.5 w-3.5" />}
            label="Bedrooms"
            value={template.bedrooms > 0 ? String(template.bedrooms) : '—'}
            sub={<span className="flex items-center gap-1"><Bath className="h-3 w-3" />{template.bathrooms} bath</span>}
          />
          <Stat icon={<Sofa className="h-3.5 w-3.5" />} label="Furnished" value={`${stats.objects} items`} sub={`${stats.doors} doors · ${stats.windows} windows`} />
        </div>
      )}

      {!empty && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Rooms</h4>
            <ul className="space-y-0.5 text-[11px]">
              {stats.rooms.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-zinc-400">
                  <span className="truncate">{r.name}</span>
                  <span className="shrink-0 tabular-nums text-zinc-500">{r.area.toFixed(1)} m²</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Why this one</h4>
            <ul className="space-y-1 text-[11px] leading-relaxed text-zinc-400">
              {template.highlights.map((h) => (
                <li key={h} className="flex gap-1.5">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                  {h}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-zinc-500">
              <span className="text-zinc-400">Best for:</span> {template.bestFor}
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-800 pt-3">
        <p className="text-[11px] text-zinc-500">
          Everything is editable — move walls, swap furniture, then press <span className="text-zinc-300">2</span> for the 3D preview.
        </p>
        <button
          onClick={onPick}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500"
        >
          Use this plan <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-zinc-100">{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}
