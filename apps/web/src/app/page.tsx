'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Layers, Box, Sparkles, Palette, Database, ArrowRight, Upload, Copy, Pencil, Check, X, Cloud, HardDrive, Loader2 } from 'lucide-react';
import type { Project } from '@interior/core';
import { deleteProjectLocal, parseProjectFile, readFileAsText, remoteDelete, remoteSave, saveProjectLocal, syncProjectList } from '@/lib/storage';
import { TEMPLATES, templateStats, type ProjectTemplate } from '@/lib/templates';
import { PlanThumbnail } from '@/components/PlanThumbnail';
import { TemplateGallery } from '@/components/TemplateGallery';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

const FEATURES = [
  { icon: <Box className="h-4 w-4 text-sky-400" />, title: '2D floor plans', text: 'Draw walls, add doors & windows with live snapping. Box-select, nudge with the arrow keys, undo anything.' },
  { icon: <Layers className="h-4 w-4 text-indigo-400" />, title: 'Real-time 3D preview', text: 'The same model rendered in Three.js. Drag, rotate and scale furniture with on-screen handles.' },
  { icon: <Sparkles className="h-4 w-4 text-emerald-400" />, title: 'AI assistant', text: 'Type "add a green sofa near the window" and review the proposed changes before applying.' },
  { icon: <Palette className="h-4 w-4 text-amber-400" />, title: 'Materials & lighting', text: 'Wood, stone, metal and fabric finishes for walls, floors and furniture. Four lighting presets.' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [online, setOnline] = React.useState<boolean | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [templateFocus, setTemplateFocus] = React.useState<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = React.useState<Project | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(async () => {
    const result = await syncProjectList();
    setProjects(result.projects);
    setOnline(result.online);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = (p: Project) => {
    saveProjectLocal(p);
    void remoteSave(p);
    router.push(`/editor/${p.id}`);
  };

  /**
   * The gallery has already built the plan for its own preview, so it hands
   * that project straight through: what you compared is what you open.
   */
  const createFromTemplate = (project: Project, template: ProjectTemplate) => {
    // Number blank projects so the list doesn't fill with "Untitled Project".
    if (template.id === 'blank') project.name = `Studio Project ${projects.length + 1}`;
    setTemplateOpen(false);
    open(project);
  };

  const browseTemplates = (focusId?: string) => {
    setTemplateFocus(focusId);
    setTemplateOpen(true);
  };

  const remove = async (p: Project) => {
    deleteProjectLocal(p.id);
    setProjects((list) => list.filter((x) => x.id !== p.id));
    setConfirmDelete(null);
    await remoteDelete(p.id);
  };

  const duplicate = (p: Project) => {
    const copy: Project = {
      ...structuredClone(p),
      id: 'project-' + Math.random().toString(36).slice(2, 10),
      name: `${p.name} (copy)`,
      updatedAt: Date.now(),
    };
    saveProjectLocal(copy);
    void remoteSave(copy);
    setProjects((list) => [copy, ...list]);
  };

  const rename = (p: Project, name: string) => {
    const next = { ...p, name: name.trim() || p.name, updatedAt: Date.now() };
    saveProjectLocal(next);
    void remoteSave(next);
    setProjects((list) => list.map((x) => (x.id === p.id ? next : x)).sort((a, b) => b.updatedAt - a.updatedAt));
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const imported = parseProjectFile(await readFileAsText(file));
      open(imported);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <main className="min-h-screen bg-[#090b10] text-zinc-200">
      <div className="mx-auto max-w-5xl px-6 pb-24 pt-12">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
              <Layers className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-semibold">Interior Studio</h1>
              <p className="text-sm text-zinc-500">AI-assisted interior design, in your browser</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                online === true && 'border-emerald-500/40 text-emerald-400',
                online === false && 'border-zinc-700 text-zinc-400',
                online === null && 'border-zinc-800 text-zinc-600',
              )}
              title={online ? 'Projects sync to the backend and open on any device' : 'Backend not reachable — projects are stored in this browser'}
            >
              {online === null ? <Loader2 className="h-3 w-3 animate-spin" /> : online ? <Cloud className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}
              {online === true ? 'Synced' : online === false ? 'Local only' : 'Connecting…'}
            </span>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
              title="Import a project exported as JSON"
            >
              <Upload className="h-4 w-4" /> Import
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void handleImport(e.target.files?.[0])} />
            <button onClick={() => browseTemplates()} className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500">
              <Plus className="h-4 w-4" /> New project
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
            <button onClick={() => setError(null)} className="rounded p-0.5 hover:bg-red-500/20">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <section className="mb-12">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Your projects</h2>
          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-44 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-14 text-center">
              <Database className="mx-auto mb-3 h-10 w-10 text-zinc-700" />
              <p className="text-sm text-zinc-400">No projects yet.</p>
              <p className="mb-5 text-xs text-zinc-600">Start from a furnished template, or draw a space from scratch.</p>
              <button onClick={() => browseTemplates()} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500">
                <Plus className="h-4 w-4" /> Create a project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} onDelete={() => setConfirmDelete(p)} onDuplicate={() => duplicate(p)} onRename={(name) => rename(p, name)} />
              ))}
            </div>
          )}
        </section>

        <section className="mb-12">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Ready-made house plans</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Complete homes — walls, doors, windows and furniture already placed. Open one to compare layouts, then edit it as your own.
              </p>
            </div>
            <button onClick={() => browseTemplates()} className="shrink-0 text-[11px] font-medium text-sky-400 hover:text-sky-300">
              Compare all plans
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TEMPLATES.filter((t) => t.id !== 'blank')
              .slice(0, 4)
              .map((t) => (
                <TemplateCard key={t.id} template={t} onPick={() => browseTemplates(t.id)} />
              ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">What you can do</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-800/70">{f.icon}</span>
                <div>
                  <div className="text-sm font-medium text-zinc-100">{f.title}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-zinc-500">{f.text}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Dialog open={templateOpen} onClose={() => setTemplateOpen(false)} title="Start from a plan" width="max-w-5xl">
        <p className="mb-3 text-xs text-zinc-500">
          Compare the layouts, then open one — every wall, door and piece of furniture stays editable.
        </p>
        <TemplateGallery initialId={templateFocus} onPick={createFromTemplate} />
      </Dialog>

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete project?">
        <p className="text-sm text-zinc-300">
          <span className="font-medium text-zinc-100">{confirmDelete?.name}</span> will be removed from this browser
          {online ? ' and from the server' : ''}. This can&apos;t be undone — export it first if you want a copy.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setConfirmDelete(null)} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
            Cancel
          </button>
          <button onClick={() => confirmDelete && void remove(confirmDelete)} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500">
            Delete
          </button>
        </div>
      </Dialog>
    </main>
  );
}

function TemplateCard({ template, onPick }: { template: ProjectTemplate; onPick: () => void }) {
  // Build a preview instance once per card; templates are cheap pure functions.
  const preview = React.useMemo(() => template.build(), [template]);
  const stats = React.useMemo(() => templateStats(preview), [preview]);
  return (
    <button onClick={onPick} className="group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 text-left transition-colors hover:border-sky-500/50">
      <div className="h-28 border-b border-zinc-800/70 bg-[#0c0f14] p-2">
        <PlanThumbnail project={preview} className="h-full w-full" />
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">{template.name}</span>
          <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
            {template.badge}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          {stats.footprint} · {stats.carpetArea.toFixed(0)} m² · {stats.objects} items
        </div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">{template.description}</p>
      </div>
    </button>
  );
}

function ProjectCard({ project: p, onDelete, onDuplicate, onRename }: { project: Project; onDelete: () => void; onDuplicate: () => void; onRename: (name: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(p.name);
  const floors = p.floors.length;
  const objects = p.floors.reduce((n, f) => n + f.objects.length, 0);
  const walls = p.floors.reduce((n, f) => n + f.walls.length, 0);

  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== p.name) onRename(name);
    else setName(p.name);
  };

  return (
    <div className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 transition-colors hover:border-sky-500/40">
      <Link href={`/editor/${p.id}`} className="block">
        <div className="h-28 border-b border-zinc-800/70 bg-[#0c0f14] p-2">
          <PlanThumbnail project={p} className="h-full w-full" />
        </div>
      </Link>
      <div className="p-3">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  setName(p.name);
                  setEditing(false);
                }
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-sky-500/60 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none"
            />
            <button onMouseDown={(e) => e.preventDefault()} onClick={commit} className="rounded p-1 text-emerald-400 hover:bg-zinc-800">
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <Link href={`/editor/${p.id}`} className="block">
            <div className="truncate text-sm font-medium text-zinc-100">{p.name}</div>
          </Link>
        )}
        <div className="mt-0.5 text-[11px] text-zinc-500">
          {floors} floor{floors > 1 ? 's' : ''} · {walls} wall{walls === 1 ? '' : 's'} · {objects} object{objects === 1 ? '' : 's'} · {relativeTime(p.updatedAt)}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Link href={`/editor/${p.id}`} className="flex items-center gap-1 text-[11px] font-medium text-sky-400">
            Open editor <ArrowRight className="h-3 w-3" />
          </Link>
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <IconAction title="Rename" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction title="Duplicate" onClick={onDuplicate}>
              <Copy className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction title="Delete" onClick={onDelete} danger>
              <Trash2 className="h-3.5 w-3.5" />
            </IconAction>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconAction({ title, onClick, danger, children }: React.PropsWithChildren<{ title: string; onClick: () => void; danger?: boolean }>) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn('rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200', danger && 'hover:bg-red-500/15 hover:text-red-400')}
    >
      {children}
    </button>
  );
}

function relativeTime(ts: number): string {
  if (!ts) return 'never edited';
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(ts).toLocaleDateString();
}
