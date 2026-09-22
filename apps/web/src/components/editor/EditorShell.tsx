'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useEditorStore } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';
import { useCan, useIsShareSession, useSessionStore } from '@/stores/session-store';
import { fetchAiStatus } from '@/lib/ai';
import { cn } from '@/lib/cn';
import { TopBar } from './TopBar';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { BottomBar } from './BottomBar';
import { AiAssistant } from './AiAssistant';
import { KeyboardShortcuts } from './Shortcuts';
import { ShortcutsDialog } from './ShortcutsDialog';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
import { ClientSummaryPanel } from './ClientSummaryPanel';

const Canvas2D = dynamic(() => import('./Canvas2D').then((m) => m.Canvas2D), { ssr: false, loading: () => <CanvasLoading label="Loading 2D engine…" /> });
const Canvas3D = dynamic(() => import('./Canvas3D').then((m) => m.Canvas3D), { ssr: false, loading: () => <CanvasLoading label="Loading 3D engine…" /> });

export function EditorShell() {
  const view = useEditorStore((s) => s.view);
  const leftOpen = useUiStore((s) => s.leftOpen);
  const rightOpen = useUiStore((s) => s.rightOpen);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const setAiEngine = useUiStore((s) => s.setAiEngine);
  const canEdit = useCan('edit');
  const canUseAi = useCan('ai');
  const isShare = useIsShareSession();

  // A share session is set by the viewer route before this mounts; an account
  // session has to be fetched once so the UI knows what to offer.
  React.useEffect(() => {
    if (useSessionStore.getState().session?.kind === 'share') return;
    void useSessionStore.getState().loadAccount();
  }, []);

  // Only interrupt navigation when there is genuinely unsaved work. The
  // previous handler prompted "Leave site?" unconditionally, even seconds
  // after an autosave, which trains people to click through the warning.
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const store = useEditorStore.getState();
      if (!store.dirty || !canEdit) return;
      store.save();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [canEdit]);

  // Which AI engine the assistant will use — shown in its header.
  React.useEffect(() => {
    if (!canUseAi) return;
    let cancelled = false;
    void fetchAiStatus().then((status) => {
      if (!cancelled) setAiEngine(status);
    });
    return () => {
      cancelled = true;
    };
  }, [setAiEngine, canUseAi]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#090b10] text-zinc-200">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {/* The catalog, structure and material tabs are all editing tools. */}
        {leftOpen && canEdit && <LeftPanel />}
        <main className="relative min-w-0 flex-1 overflow-hidden bg-[#0c0f14]">
          {view === '2d' ? (
            <CanvasErrorBoundary label="floor plan">
              <Canvas2D />
            </CanvasErrorBoundary>
          ) : (
            <CanvasErrorBoundary label="3D view">
              <Canvas3D />
            </CanvasErrorBoundary>
          )}
          {aiOpen && canUseAi && <AiAssistant />}
          <ModalTransformHud />
          <ViewSwitchOverlay />
          <ToolHint />
        </main>
        {/* Clients get a read-only schedule of the design instead of the
            property editor: the numbers they care about, nothing to break. */}
        {rightOpen && (canEdit ? <RightPanel /> : <ClientSummaryPanel />)}
      </div>
      <BottomBar />
      <Toasts />
      <KeyboardShortcuts />
      <ShortcutsDialog />
    </div>
  );
}

function ViewSwitchOverlay() {
  const view = useEditorStore((s) => s.view);
  const floor = useEditorStore((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.name ?? '');
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-10 select-none rounded-md bg-black/40 px-2 py-1 text-[11px] font-medium tracking-wider text-zinc-400 backdrop-blur">
      {view === '2d' ? '2D FLOOR PLAN' : '3D VIEW'} · {floor.toUpperCase()}
    </div>
  );
}

/**
 * One line at the bottom of the canvas saying what the current tool expects.
 * The drawing gestures (click-click-Enter, right-click to close a room) are
 * not discoverable otherwise.
 */
function ToolHint() {
  const tool = useEditorStore((s) => s.tool);
  const view = useEditorStore((s) => s.view);
  const selectionCount = useEditorStore((s) => s.selection.length);
  const pending = useUiStore((s) => s.pendingAsset);
  const measuring = useUiStore((s) => s.measureWidget.active);
  const spacePan = useUiStore((s) => s.spaceHeld);
  const canEdit = useCan('edit');

  let text: string;
  if (!canEdit) {
    text =
      view === '3d'
        ? 'Left-drag to look around · Middle-drag or Space-drag to pan · Scroll to zoom · Press 1 for the floor plan'
        : 'Hold Space and drag to pan · Scroll to zoom · Press 2 for the 3D walkthrough';
  } else if (pending) {
    text = `Click where to place ${pending.name} · Esc to cancel`;
  } else if (spacePan) {
    text = 'Space held — drag to pan the view · release to go back to the ' + (view === '3d' ? '3D' : 'plan') + ' tool';
  } else if (view === '3d') {
    text =
      tool === 'pan'
        ? 'Drag to pan · Scroll to zoom · Right-drag also pans · V to go back to selecting'
        : selectionCount === 1
          ? 'Drag the handles to move, rotate or scale · Hold Space or press H to pan · Scroll to zoom'
          : 'Click furniture to select it · Left-drag orbits · Right-drag or Space-drag pans · Scroll to zoom';
  } else {
    switch (tool) {
      case 'wall':
        text = 'Click to start a wall, click for each corner · Enter or double-click to finish · Esc to cancel';
        break;
      case 'room':
        text = 'Click each corner of the room · Right-click, Enter or double-click to close it';
        break;
      case 'door':
      case 'window':
        text = `Click on a wall to insert a ${tool} · V to go back to selecting`;
        break;
      case 'measure':
        text = measuring ? 'Click the second point' : 'Click two points to measure · Esc to clear';
        break;
      case 'pan':
        text = 'Drag to pan · Scroll to zoom · V to go back to selecting · Space pans with any tool';
        break;
      default:
        text =
          selectionCount > 0
            ? 'Drag to move · Arrow keys nudge · [ ] rotate · Del removes · Ctrl+D duplicates'
            : 'Click to select · Drag furniture to move it · Hold Space (or press H) to pan · Scroll to zoom';
    }
  }

  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[90%] -translate-x-1/2 select-none truncate rounded-md bg-black/45 px-3 py-1.5 text-[11px] text-zinc-300 backdrop-blur">
      {text}
    </div>
  );
}

/**
 * Read-out for a running G/R/S transform: which mode, which axis is locked,
 * and the exact delta. Blender puts the same information in the header — it is
 * what turns "drag until it looks right" into a measured move.
 */
function ModalTransformHud() {
  const modal = useUiStore((s) => s.modalTransform);
  if (!modal) return null;
  const verb = modal.mode === 'translate' ? 'Move' : modal.mode === 'rotate' ? 'Rotate' : 'Scale';
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-sky-500/40 bg-[#0d1016]/95 px-3 py-1.5 text-[11px] text-zinc-200 shadow-xl backdrop-blur">
      <span className="font-semibold text-sky-300">{verb}</span>
      {modal.axis && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-medium text-sky-200">{modal.axis === 'x' ? 'X axis' : 'Y axis'}</span>}
      <span className="tabular-nums">{modal.typed ? modal.typed : modal.readout}</span>
      <span className="text-zinc-500">· click or Enter to confirm · Esc to cancel</span>
    </div>
  );
}

function CanvasLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-sky-500" />
        {label}
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useEditorStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-16 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-center gap-2 rounded-lg border bg-zinc-900/95 px-3 py-2 text-xs text-zinc-100 shadow-xl backdrop-blur',
            t.kind === 'success' && 'border-emerald-500/40',
            t.kind === 'error' && 'border-red-500/40',
            t.kind === 'info' && 'border-zinc-700',
          )}
        >
          {t.kind === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          {t.kind === 'error' && <AlertTriangle className="h-4 w-4 text-red-400" />}
          {t.kind === 'info' && <Info className="h-4 w-4 text-sky-400" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
