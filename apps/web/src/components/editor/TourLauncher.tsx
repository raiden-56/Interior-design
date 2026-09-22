'use client';

import * as React from 'react';
import { Compass, X } from 'lucide-react';
import 'driver.js/dist/driver.css';
import { startEditorTour, hasSeenTour, markTourSeen } from '@/lib/tour';
import { useEditorStore } from '@/stores/editor-store';
import { useCan } from '@/stores/session-store';

/**
 * Offers the tour on a first visit, and keeps a way back to it afterwards.
 *
 * The offer is a dismissible card rather than a tour that just starts: being
 * dropped into a walkthrough you did not ask for is the fastest way to make
 * someone hunt for the close button. "Skip" is a real answer and is remembered.
 */
export function TourLauncher() {
  const [offer, setOffer] = React.useState(false);
  const project = useEditorStore((s) => s.project);
  // A client is not being shown tools they do not have.
  const canEdit = useCan('edit');

  React.useEffect(() => {
    if (hasSeenTour()) return;
    // Let the editor finish mounting before anything appears over it.
    const timer = setTimeout(() => setOffer(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  // The tour points at real elements, so it waits for the project to load.
  const begin = React.useCallback(() => {
    setOffer(false);
    void startEditorTour();
  }, []);

  const skip = () => {
    setOffer(false);
    markTourSeen();
  };

  React.useEffect(() => {
    const onRequest = () => begin();
    window.addEventListener('interior:start-tour', onRequest);
    return () => window.removeEventListener('interior:start-tour', onRequest);
  }, [begin]);

  if (!offer || !project) return null;

  return (
    <div className="pointer-events-auto absolute bottom-16 left-1/2 z-50 w-[22rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-sky-500/40 bg-[#0d1016]/97 p-4 shadow-2xl backdrop-blur">
      <button
        onClick={skip}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-300">
          <Compass className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-100">{canEdit ? 'First time here?' : 'New to this preview?'}</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {canEdit
              ? 'A two-minute walk through every tool — drawing, furniture, materials, 3D, sharing. You can leave it at any point.'
              : 'Thirty seconds on how to move around the design and where to find the room areas.'}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={begin} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500">
              Show me around
            </button>
            <button onClick={skip} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800">
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Anything can ask for the tour: `window.dispatchEvent(new Event('interior:start-tour'))`. */
export function requestTour(): void {
  window.dispatchEvent(new Event('interior:start-tour'));
}
