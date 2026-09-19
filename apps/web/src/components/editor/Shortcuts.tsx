'use client';

import * as React from 'react';
import { gridStep } from '@interior/core';
import { useEditorStore, type Tool } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  b: 'wall',
  d: 'door',
  n: 'window',
  r: 'room',
  m: 'measure',
  h: 'pan',
};

/** One row of the shortcuts help dialog. Kept next to the handler so they can't drift. */
export const SHORTCUT_GROUPS: { title: string; items: { keys: string; action: string }[] }[] = [
  {
    title: 'Tools',
    items: [
      { keys: 'V', action: 'Select / move' },
      { keys: 'B', action: 'Draw walls' },
      { keys: 'D', action: 'Place door' },
      { keys: 'N', action: 'Place window' },
      { keys: 'R', action: 'Draw room' },
      { keys: 'M', action: 'Measure' },
      { keys: 'H', action: 'Hand / pan tool — works in the plan and in 3D' },
      { keys: 'Space (hold)', action: 'Hold to pan with any tool — plan and 3D' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: 'Delete / Backspace', action: 'Delete selection' },
      { keys: 'Ctrl + D', action: 'Duplicate furniture' },
      { keys: '↑ ↓ ← →', action: 'Nudge furniture one grid step (Shift: ×4)' },
      { keys: '[  ]', action: 'Rotate furniture 15°' },
      { keys: 'Enter / double-click', action: 'Finish wall chain or room' },
      { keys: 'Esc', action: 'Cancel drawing, placement or selection' },
      { keys: 'Ctrl + Z / Ctrl + Shift + Z', action: 'Undo / redo' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: '1 / 2', action: 'Floor plan / 3D view' },
      { keys: 'F', action: 'Fit view' },
      { keys: 'Scroll', action: 'Zoom' },
      { keys: 'Middle-drag', action: 'Pan, whatever the active tool is' },
      { keys: 'Right-drag (3D)', action: 'Pan the 3D camera' },
      { keys: 'Ctrl + B / Ctrl + ]', action: 'Toggle left / right panel' },
      { keys: 'Ctrl + K', action: 'AI assistant' },
      { keys: 'Ctrl + S', action: 'Save' },
      { keys: '?', action: 'This help' },
    ],
  },
];

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function KeyboardShortcuts() {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const store = useEditorStore.getState();
      const ui = useUiStore.getState();
      const key = e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && key === 's') {
        e.preventDefault();
        void store.saveNow();
        store.pushToast('Project saved', 'success');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && key === 'z') {
        e.preventDefault();
        store.redo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault();
        store.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 'y') {
        e.preventDefault();
        store.redo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 'k') {
        e.preventDefault();
        ui.toggleAi();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 'b') {
        e.preventDefault();
        ui.toggleLeft();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === ']') {
        e.preventDefault();
        ui.toggleRight();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 'd') {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        store.duplicateSelection();
        return;
      }

      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (ui.shortcutsOpen) {
          ui.setShortcutsOpen(false);
          return;
        }
        if (ui.aiOpen) {
          ui.toggleAi();
          return;
        }
        store.cancelInteraction();
        return;
      }

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        ui.setShortcutsOpen(!ui.shortcutsOpen);
        return;
      }

      if (e.key === 'Enter') {
        // Finish the wall chain / room polygon being drawn.
        if (store.editor2D?.hasDraft()) {
          e.preventDefault();
          store.editor2D.commitDraft();
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selection.length === 0) return;
        e.preventDefault();
        store.deleteSelection();
        return;
      }

      // Nudge furniture with the arrow keys. Y in the plan is Z in 3D.
      if (e.key.startsWith('Arrow') && store.selection.length > 0) {
        const step = gridStep(store.project.units) * (e.shiftKey ? 4 : 1);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dz = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (dx || dz) {
          e.preventDefault();
          store.nudgeSelection(dx, dz);
        }
        return;
      }

      if (e.key === '[' || e.key === ']') {
        if (store.selection.length === 0) return;
        e.preventDefault();
        store.rotateSelection(((e.key === '[' ? -15 : 15) * Math.PI) / 180);
        return;
      }

      if (e.key === '1' || e.key === '2') {
        store.setView(e.key === '1' ? '2d' : '3d');
        return;
      }

      if (key === 'f') {
        if (store.view === '2d') store.editor2D?.fitView();
        else ui.requestCameraFit();
        return;
      }

      if (e.key === ' ' || e.key === 'Spacebar') {
        // Hold-to-pan, in the floor plan and in 3D. The flag lives in the UI
        // store and each canvas reads it per gesture, so the tool the user
        // picked stays active and releasing Space cannot strand them in Pan.
        ui.setSpaceHeld(true);
        e.preventDefault();
        return;
      }

      const tool = TOOL_KEYS[key];
      if (tool) {
        // Pan works in both views; the drawing tools need the floor plan.
        if (store.view === '3d' && tool !== 'select' && tool !== 'pan') {
          store.pushToast('Drawing tools work in the floor plan — press 1 to switch', 'info');
          return;
        }
        store.setTool(tool);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Spacebar') useUiStore.getState().setSpaceHeld(false);
    };
    // Alt-tabbing away while Space is down never delivers the keyup, which
    // would otherwise leave every canvas stuck in pan mode.
    const releaseSpace = () => useUiStore.getState().setSpaceHeld(false);

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseSpace);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseSpace);
    };
  }, []);

  return null;
}
