'use client';

import * as React from 'react';
import { Sparkles, Send, X, Check, ListChecks, ChevronRight } from 'lucide-react';
import { useEditorStore } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';
import { planAiSmart, SUGGESTED_PROMPTS, type AiAction } from '@/lib/ai';
import { cn } from '@/lib/cn';

export function AiAssistant() {
  const toggleAi = useUiStore((s) => s.toggleAi);
  const setAiPending = useUiStore((s) => s.setAiPending);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<AiAction[] | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [engineUsed, setEngineUsed] = React.useState<string | null>(null);
  const aiEngine = useUiStore((s) => s.aiEngine);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (text?: string) => {
    const q = (text ?? prompt).trim();
    if (!q || busy) return;
    setBusy(true);
    setResults(null);
    const { project, activeFloorId } = useEditorStore.getState();
    const floor = project.floors.find((f) => f.id === activeFloorId) ?? project.floors[0];
    const result = await planAiSmart(q, project, floor, Boolean(useUiStore.getState().aiEngine?.enabled));
    setResults(result.actions);
    setEngineUsed(result.engine);
    setBusy(false);
    if (result.note) useEditorStore.getState().pushToast(result.note, 'info');
    else if (result.actions.length === 0) useEditorStore.getState().pushToast('No suggestion found — try rephrasing', 'info');
  };

  const applyAll = () => {
    if (!results) return;
    const all = results.flatMap((r) => r.commands);
    useEditorStore.getState().runBatch(all, `AI: ${results.map((r) => r.summary).join('; ')}`);
    useEditorStore.getState().pushToast(`Applied ${all.length} change${all.length > 1 ? 's' : ''}`, 'success');
    setResults(null);
    setAiPending(null);
  };

  const count = results?.reduce((n, r) => n + r.commands.length, 0) ?? 0;

  return (
    <div className="absolute bottom-3 right-3 z-40 flex w-[23rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-[#10131a]/95 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
          <Sparkles className="h-3.5 w-3.5" /> AI Assistant
          <span
            className="rounded-full border border-zinc-700 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-zinc-400"
            title={aiEngine?.enabled ? `Planned by ${aiEngine.model} on the backend; you still confirm every change` : 'Built-in rule engine (works offline). Set ANTHROPIC_API_KEY on the backend to enable Claude.'}
          >
            {aiEngine?.enabled ? 'Claude' : 'Rules'}
          </span>
        </span>
        <button onClick={toggleAi} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="Close (Ctrl+K)">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto p-3">
        <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
          Describe what you want — furniture placement, wall colors, room layout. Changes are proposed for your review
          and only applied when you confirm.
        </p>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {SUGGESTED_PROMPTS.map((s) => (
            <button
              key={s}
              onClick={() => void submit(s)}
              className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-400 hover:border-sky-500/40 hover:text-zinc-200"
            >
              {s.length > 34 ? s.slice(0, 34) + '…' : s}
            </button>
          ))}
        </div>

        {busy && (
          <div className="flex items-center gap-2 py-2 text-xs text-zinc-400">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-sky-500" />
            {aiEngine?.enabled ? 'Asking Claude…' : 'Analyzing your request…'}
          </div>
        )}

        {!busy && results && results.length > 0 && (
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50">
                <button
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium',
                    r.severity === 'warning' && 'text-amber-300',
                    r.severity === 'info' && 'text-zinc-200',
                  )}
                >
                  <ChevronRight className={cn('h-3.5 w-3.5 text-zinc-500 transition-transform', expanded === r.id && 'rotate-90')} />
                  <span className="flex-1">{r.summary}</span>
                  <span className="text-[10px] text-zinc-500">{r.commands.length}</span>
                </button>
                {expanded === r.id && (
                  <ul className="space-y-0.5 border-t border-zinc-800/70 px-3 py-2">
                    {r.commands.map((c, i) => (
                      <li key={i} className="flex items-center gap-2 text-[11px] text-zinc-500">
                        <ListChecks className="h-3 w-3 shrink-0 text-sky-500/60" />
                        {c.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {engineUsed && engineUsed !== 'rules' && (
              <p className="text-[10px] text-zinc-500">Proposed by {engineUsed}. Review each change, then apply.</p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={applyAll}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500"
              >
                <Check className="h-3.5 w-3.5" /> Apply {count} change{count > 1 ? 's' : ''}
              </button>
              <button
                onClick={() => setResults(null)}
                className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {!busy && results && results.length === 0 && (
          <div className="rounded-md bg-zinc-900/50 px-3 py-3 text-center text-xs text-zinc-500">
            I could not turn that into changes. Try something like <em>"add a coffee table near the sofa"</em>.
          </div>
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t border-zinc-800 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. add a green sofa near the window…"
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-sky-500/50"
        />
        <button
          type="submit"
          disabled={busy || !prompt.trim()}
          className="rounded-md bg-sky-600 p-2 text-white hover:bg-sky-500 disabled:opacity-40"
          title="Ask (Enter)"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}