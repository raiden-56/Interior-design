'use client';

import * as React from 'react';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from '@/components/ui/dialog';
import { SHORTCUT_GROUPS } from './Shortcuts';

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const onClose = React.useCallback(() => setOpen(false), [setOpen]);

  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width="max-w-2xl">
      <div className="grid gap-5 sm:grid-cols-3">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{group.title}</h3>
            <ul className="space-y-1.5">
              {group.items.map((item) => (
                <li key={item.keys} className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-zinc-400">{item.action}</span>
                  <kbd className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono2 text-[10px] text-zinc-200">
                    {item.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-5 text-[11px] leading-relaxed text-zinc-500">
        Drawing a wall: click to start, click again for each corner, Enter or double-click to finish. Drawing a room: click each
        corner, then right-click, Enter or double-click to close it. Furniture: pick it in the left panel, then click where it
        should go.
      </p>
    </Dialog>
  );
}
