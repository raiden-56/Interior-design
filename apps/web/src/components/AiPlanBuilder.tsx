'use client';

import * as React from 'react';
import { Sparkles, KeyRound, Plug, Loader2, Copy, Check, ArrowRight, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import type { Project } from '@interior/core';
import { PlanThumbnail } from '@/components/PlanThumbnail';
import { templateStats } from '@/lib/templates';
import { cn } from '@/lib/cn';

/**
 * "Build a plan with your AI": two doors into the same place.
 *
 * 1. Bring your own key — Claude or OpenAI. The key is sent with the request
 *    and used once; it is remembered in this browser only when asked.
 * 2. Connect an AI app over MCP — Claude Desktop, Cursor, Codex or Claude Code
 *    get tools that build and edit projects in the studio directly.
 */
type Provider = 'anthropic' | 'openai';

const PROVIDERS: { id: Provider; label: string; models: string[]; keyHint: string; keysUrl: string }[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)', models: ['claude-opus-5-5', 'claude-sonnet-5-5'], keyHint: 'sk-ant-…', keysUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI', models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'], keyHint: 'sk-…', keysUrl: 'https://platform.openai.com/api-keys' },
];

const EXAMPLES = [
  'A 2 BHK apartment, 10 × 9 m, living-dining across the front with a balcony, kitchen with an island, both bedrooms with wardrobes and an attached bathroom for the master.',
  'Compact studio for one person, 6 × 8 m: sleeping nook, work desk by the window, galley kitchen, bathroom with shower.',
  'Two-storey 3 BHK villa, 12 × 10 m footprint: living, dining, kitchen, guest room and a bathroom downstairs; a staircase to the master bedroom with en-suite, two kids’ rooms and a family bathroom upstairs.',
];

const KEY_STORAGE = 'interior.ai.byok.v1';

interface Stored {
  provider: Provider;
  model: string;
  apiKey?: string;
}

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

export function AiPlanBuilder({ onOpen }: { onOpen: (project: Project) => void }) {
  const [tab, setTab] = React.useState<'key' | 'mcp'>('key');
  return (
    <section className="mb-12">
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Build a plan with your AI</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Describe the home and let a model draw the walls, rooms, doors, windows and furniture — with your own API key, or from Claude, Cursor or Codex connected over MCP. Everything it produces opens as a normal, editable project.
        </p>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center gap-1 border-b border-zinc-800 px-2 pt-2">
          <TabBtn active={tab === 'key'} onClick={() => setTab('key')} icon={<KeyRound className="h-3.5 w-3.5" />} label="Use your API key" />
          <TabBtn active={tab === 'mcp'} onClick={() => setTab('mcp')} icon={<Plug className="h-3.5 w-3.5" />} label="Connect Claude · Cursor · Codex (MCP)" />
        </div>
        <div className="p-4">{tab === 'key' ? <ByokPanel onOpen={onOpen} /> : <McpPanel />}</div>
      </div>
    </section>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={cn('flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200', active && 'border-b-2 border-sky-400 text-sky-300')}>
      {icon}
      {label}
    </button>
  );
}

// --- bring your own key ------------------------------------------------------------

function ByokPanel({ onOpen }: { onOpen: (project: Project) => void }) {
  const stored = React.useMemo(() => (typeof window === 'undefined' ? null : loadStored()), []);
  const [provider, setProvider] = React.useState<Provider>(stored?.provider ?? 'anthropic');
  const [model, setModel] = React.useState(stored?.model ?? PROVIDERS[0].models[0]);
  const [apiKey, setApiKey] = React.useState(stored?.apiKey ?? '');
  const [remember, setRemember] = React.useState(!!stored?.apiKey);
  const [showKey, setShowKey] = React.useState(false);
  const [brief, setBrief] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ project: Project; notes: string[]; warnings: string[]; engine: string } | null>(null);
  const prov = PROVIDERS.find((p) => p.id === provider)!;

  const pickProvider = (p: Provider) => {
    setProvider(p);
    setModel(PROVIDERS.find((x) => x.id === p)!.models[0]);
  };

  const persist = (key: string, keep: boolean) => {
    try {
      localStorage.setItem(KEY_STORAGE, JSON.stringify({ provider, model, ...(keep ? { apiKey: key } : {}) } satisfies Stored));
    } catch {
      /* ignore */
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    persist(apiKey, remember);
    try {
      const res = await fetch('/api/ai/generate-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, model, brief }),
      });
      const data = (await res.json().catch(() => ({}))) as { project?: Project; notes?: string[]; warnings?: string[]; engine?: string; error?: string };
      if (!res.ok || !data.project) {
        setError(data.error ?? `Generation failed (${res.status})`);
        return;
      }
      setResult({ project: data.project, notes: data.notes ?? [], warnings: data.warnings ?? [], engine: data.engine ?? model });
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const stats = result ? templateStats(result.project) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map((p) => (
            <button key={p.id} onClick={() => pickProvider(p.id)} className={cn('rounded-lg border px-3 py-2 text-left text-xs', provider === p.id ? 'border-sky-500/60 bg-sky-500/10 text-sky-200' : 'border-zinc-800 text-zinc-300 hover:border-zinc-700')}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`${prov.label} API key (${prov.keyHint})`}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 pr-9 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/60"
            />
            <button onClick={() => setShowKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200" title={showKey ? 'Hide key' : 'Show key'}>
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <input list={`models-${provider}`} value={model} onChange={(e) => setModel(e.target.value)} className="w-40 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-sky-500/60" title="Model" />
          <datalist id={`models-${provider}`}>
            {prov.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-sky-500" />
            Remember the key in this browser
          </label>
          <a href={prov.keysUrl} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300">
            Get a key ↗
          </a>
        </div>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={5}
          placeholder="Describe the home: size, rooms, what goes where, style…"
          className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/60"
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((e, i) => (
            <button key={i} onClick={() => setBrief(e)} className="rounded-full border border-zinc-800 px-2.5 py-1 text-[10px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200">
              Example {i + 1}
            </button>
          ))}
        </div>
        <button
          onClick={() => void generate()}
          disabled={busy || !apiKey.trim() || brief.trim().length < 10}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Designing… this can take a minute or two' : 'Generate the plan'}
        </button>
        <p className="text-[10px] leading-relaxed text-zinc-600">
          The key is sent to this app&apos;s own server for the one request and never stored there. Usage is billed to your provider account.
        </p>
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
        {!result ? (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center text-xs text-zinc-600">
            <Sparkles className="mb-2 h-6 w-6 text-zinc-700" />
            The generated plan appears here with its rooms and areas before you open it.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="h-44 rounded-lg bg-[#0c0f14] p-2">
              <PlanThumbnail project={result.project} className="h-full w-full" />
            </div>
            <div>
              <div className="text-sm font-medium text-zinc-100">{result.project.name}</div>
              <div className="text-[11px] text-zinc-500">
                {stats?.footprint} · {stats?.carpetArea.toFixed(0)} m² · {stats?.objects} items · {stats?.doors} doors · {stats?.windows} windows · by {result.engine}
              </div>
            </div>
            {stats && stats.rooms.length > 0 && (
              <ul className="grid grid-cols-2 gap-x-3 text-[11px] text-zinc-400">
                {stats.rooms.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <span className="truncate">{r.name}</span>
                    <span className="text-zinc-500">{r.area.toFixed(1)} m²</span>
                  </li>
                ))}
              </ul>
            )}
            {(result.notes.length > 0 || result.warnings.length > 0) && (
              <details className="text-[11px] text-zinc-500">
                <summary className="cursor-pointer text-amber-300/80">
                  {result.notes.length + result.warnings.length} note{result.notes.length + result.warnings.length > 1 ? 's' : ''} from validation
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {[...result.notes, ...result.warnings].map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex gap-2">
              <button onClick={() => onOpen(result.project)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-500">
                Open in the editor <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => void generate()} disabled={busy} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- MCP ----------------------------------------------------------------------------

interface McpConfig {
  root: string;
  nodeRequirement: string;
  claudeDesktop: { file: string; json: unknown };
  cursor: { file: string; json: unknown };
  codex: { file: string; toml: string };
  claudeCode: string;
}

function McpPanel() {
  const [cfg, setCfg] = React.useState<McpConfig | null>(null);
  const [client, setClient] = React.useState<'claude' | 'cursor' | 'codex' | 'claude-code'>('claude');
  React.useEffect(() => {
    void fetch('/api/ai/mcp-config')
      .then((r) => r.json())
      .then((d: McpConfig) => setCfg(d))
      .catch(() => setCfg(null));
  }, []);

  const snippet = !cfg
    ? ''
    : client === 'claude'
      ? JSON.stringify(cfg.claudeDesktop.json, null, 2)
      : client === 'cursor'
        ? JSON.stringify(cfg.cursor.json, null, 2)
        : client === 'codex'
          ? cfg.codex.toml
          : cfg.claudeCode;
  const file = !cfg ? '' : client === 'claude' ? cfg.claudeDesktop.file : client === 'cursor' ? cfg.cursor.file : client === 'codex' ? cfg.codex.file : 'run in a terminal';

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3 text-xs leading-relaxed text-zinc-400">
        <p>
          The studio ships an <b className="text-zinc-200">MCP server</b> that gives an AI app tools to create projects, draw walls and rooms, hang doors and windows, place catalog furniture, validate the result and hand back a link that opens it here. Your assistant does the designing with its own model and account; nothing extra to pay for in the studio.
        </p>
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>
            Start the storage service once: <code className="rounded bg-zinc-800 px-1">npm run dev:api</code> (the server saves plans there so links open).
          </li>
          <li>Paste the configuration on the right into your AI app and restart it.</li>
          <li>
            Ask it, for example: <i className="text-zinc-300">“Design a 2 BHK with an open kitchen in Interior Studio and give me the link.”</i>
          </li>
          <li>Open the link, edit anything, press <b className="text-zinc-200">Walk</b> to walk through it.</li>
        </ol>
        <p className="text-[11px] text-zinc-500">
          Tools: authoring_guide, list_catalog, list_templates, create_project, create_project_from_spec, add_walls, add_rectangular_room, add_room, add_door, add_window, place_furniture, update_object, remove_items, set_walkthrough_start, validate_project, export_project_json, open_in_studio.
        </p>
        {cfg && <p className="text-[11px] text-zinc-600">Requires {cfg.nodeRequirement}. Repository: {cfg.root}</p>}
      </div>
      <div>
        <div className="mb-2 flex flex-wrap gap-1">
          {(
            [
              ['claude', 'Claude Desktop'],
              ['cursor', 'Cursor'],
              ['codex', 'Codex'],
              ['claude-code', 'Claude Code'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => setClient(id)} className={cn('rounded-full border px-2.5 py-1 text-[11px]', client === id ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700')}>
              {label}
            </button>
          ))}
        </div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
          <span className="truncate">{file || 'Loading…'}</span>
          <CopyButton text={snippet} />
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-[11px] leading-relaxed text-zinc-300">{snippet || (cfg === null ? 'Could not load the configuration from the server.' : '…')}</pre>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      disabled={!text}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sky-400 hover:bg-sky-500/10 disabled:opacity-40"
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {done ? 'Copied' : 'Copy'}
    </button>
  );
}
