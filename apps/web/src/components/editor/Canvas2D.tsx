'use client';

import * as React from 'react';
import { useEditorStore, useActiveFloor } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';
import { sessionCan } from '@/stores/session-store';
import { registerCapturer } from '@/lib/capture';
import { PlanEditor2D } from './PlanEditor2D';

/**
 * Thin React shell around the PixiJS 2D plan editor. The editor reads fresh
 * state from the canonical store on every redraw; React only mounts/unmounts
 * it and forwards user actions into the command engine.
 */
export function Canvas2D() {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<PlanEditor2D | null>(null);
  const activeFloorId = useActiveFloor()?.id;

  React.useEffect(() => {
    if (!hostRef.current || editorRef.current) return;
    const editor = new PlanEditor2D(hostRef.current, {
      onCommand: (cmd) => {
        useEditorStore.getState().run(cmd);
      },
      onSelect: (ids) => useEditorStore.getState().select(ids),
      onMeasurePoint: (world) => {
        const m = useUiStore.getState().measureWidget;
        if (!m.active || !m.from) {
          useUiStore.getState().setMeasure({ from: world, to: null, active: true });
        } else {
          useUiStore.getState().setMeasure({ from: m.from, to: world, active: false });
        }
      },
      onClearPending: () => useUiStore.getState().setPendingAsset(null),
      reader: () => {
        const edit = useEditorStore.getState();
        return {
          project: edit.project,
          activeFloorId: edit.activeFloorId,
          tool: edit.tool,
          selection: edit.selection,
          measure: useUiStore.getState().measureWidget,
          units: edit.project.units,
          warnings: edit.collisionWarnings,
          spacePan: useUiStore.getState().spaceHeld,
          readOnly: !sessionCan('edit'),
          pendingAsset: useUiStore.getState().pendingAsset,
        };
      },
    });
    editorRef.current = editor;
    void editor
      .init()
      .then(() => {
        if (editorRef.current !== editor) return;
        useEditorStore.setState({ editor2D: editor });
        editor.requestRedraw();
      })
      .catch((err) => {
        console.error('[Canvas2D] failed to start:', err);
        useEditorStore.getState().pushToast(err instanceof Error ? err.message : '2D engine failed to start', 'error');
      });
    registerCapturer(async () => {
      const blob = await editor.snapshot();
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `floor-plan-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    const unsubs: (() => void)[] = [];
    unsubs.push(
      useEditorStore.subscribe((s, prev) => {
        if (s.project !== prev.project || s.activeFloorId !== prev.activeFloorId || s.tool !== prev.tool || s.selection !== prev.selection) {
          if (s.activeFloorId !== prev.activeFloorId) editor.fitView();
          if (s.tool !== prev.tool) editor.syncCursor();
          editor.requestRedraw();
        }
      }),
      useUiStore.subscribe((s, prev) => {
        if (s.measureWidget !== prev.measureWidget) editor.requestRedraw();
        // Space toggles hold-to-pan; reflect it in the cursor straight away.
        if (s.spaceHeld !== prev.spaceHeld) editor.syncCursor();
      }),
    );

    return () => {
      unsubs.forEach((u) => u());
      editorRef.current = null;
      useEditorStore.setState({ editor2D: null });
      registerCapturer(null);
      editor.destroy();
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, []);

  const floorName = useActiveFloor()?.name ?? '';
  void floorName;

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden" data-floor={activeFloorId} />;
}