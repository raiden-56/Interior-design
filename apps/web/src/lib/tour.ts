'use client';

import { driver, type DriveStep, type Driver } from 'driver.js';
import { useEditorStore } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';
import { sessionCan } from '@/stores/session-store';

/**
 * The guided tour.
 *
 * Every tool in the editor gets a stop, in the order someone would meet them:
 * what the thing is, and what you do with it. Steps that live in another view
 * or another panel bring the app to that state first — a tour that highlights
 * an element the user cannot see is worse than no tour.
 *
 * driver.js rather than one of the React tour libraries: those still cap their
 * peer dependency at React 18, and this one is framework-agnostic, positions
 * popovers against the viewport edges, and ships keyboard and progress
 * handling already.
 */

const SEEN_KEY = 'interior.tour.seen.v1';

/** Wait for React to paint the state a step asked for. */
const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Stop {
  target: string;
  title: string;
  text: string;
  /** Omitted for a full-canvas step: driver.js then places the popover itself. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Put the app into the state this stop talks about. */
  prepare?: () => void | Promise<void>;
}

const EDITOR_STOPS: Stop[] = [
  {
    target: '[data-tour="canvas"]',
    title: 'This is your floor plan',
    text: 'Everything you draw here is the same model you see in 3D — there is no export step between them. Scroll to zoom toward the cursor, hold Space and drag to pan, and press <b>F</b> to fit the whole drawing.',
    prepare: () => {
      useEditorStore.getState().setView('2d');
      useEditorStore.getState().setTool('select');
    },
  },
  {
    target: '[data-tour="tool-select"]',
    title: 'Select — V',
    text: 'Click anything to select it: a wall, a door, a room or a piece of furniture. Drag furniture to move it, drag on empty space to box-select, and use the arrow keys to nudge by one grid step.',
    side: 'top',
    align: 'start',
  },
  {
    target: '[data-tour="tool-pan"]',
    title: 'Pan — H',
    text: 'Drag to move the view around. You rarely need the button: holding <b>Space</b> pans with whatever tool is active, and the middle mouse button always pans in the plan.',
    side: 'top',
    align: 'start',
  },
  {
    target: '[data-tour="tool-wall"]',
    title: 'Wall — B',
    text: 'Click to start a wall, click again for each corner, then <b>Enter</b> or double-click to finish. Ends snap to the grid and to walls you have already drawn. <b>Esc</b> abandons the chain.',
    side: 'top',
    align: 'start',
  },
  {
    target: '[data-tour="tool-door"]',
    title: 'Door — D',
    text: 'Click anywhere on a wall and a door is cut into it, in the plan and in 3D at once. Width, height and position are editable afterwards in the properties panel.',
    side: 'top',
    align: 'start',
  },
  {
    target: '[data-tour="tool-window"]',
    title: 'Window — N',
    text: 'Same gesture as a door: click a wall. Windows carry a sill height, so the glass sits where you would expect when you walk through the room in 3D.',
    side: 'top',
    align: 'start',
  },
  {
    target: '[data-tour="tool-room"]',
    title: 'Room — R',
    text: 'Click each corner to trace a floor slab, then right-click or press <b>Enter</b> to close it. A room gives you a floor surface, a name and a live area figure.',
    side: 'top',
    align: 'start',
  },
  {
    target: '[data-tour="tool-measure"]',
    title: 'Measure — M',
    text: 'Click two points to read the distance between them. Useful for checking a walkway before you commit to furniture. <b>Esc</b> clears the measurement.',
    side: 'top',
    align: 'start',
  },
  {
    target: '[data-tour="tab-furniture"]',
    title: 'Furniture catalogue',
    text: 'Over 70 pieces at real dimensions — beds, sofas and wardrobes through to the washing machine, chimney hood, split AC and geyser. Search by name or filter by room.',
    side: 'right',
    align: 'start',
    prepare: () => useUiStore.getState().setLeftTab('furniture'),
  },
  {
    target: '[data-tour="furniture-grid"]',
    title: 'Adding an object',
    text: 'Click a piece to pick it up, then click on the plan (or in the 3D view) to place it. Items marked <b>wall</b> hang at the right height automatically — a TV at 1.5 m, a fan on the ceiling.',
    side: 'right',
    align: 'start',
  },
  {
    target: '[data-tour="tab-structure"]',
    title: 'Structure shortcuts',
    text: 'Drop in a ready-made rectangular room — 3×4, 4×5, 5×6 or 6×8 metres — instead of drawing four walls by hand. The drawing tools are repeated here with their hints.',
    side: 'right',
    align: 'start',
    prepare: () => useUiStore.getState().setLeftTab('walls'),
  },
  {
    // The whole panel, so the swatches being described are inside the
    // highlight rather than below it.
    target: '[data-tour="left-panel"]',
    title: 'Painting a wall',
    text: 'Select a wall, a floor or a piece of furniture, then click a finish here to apply it — wood, stone, metal, fabric, glass or paint. Colour and finish travel together, so a brass stays shiny and a fabric stays matte.',
    side: 'right',
    align: 'start',
    prepare: () => useUiStore.getState().setLeftTab('materials'),
  },
  {
    target: '[data-tour="right-panel"]',
    title: 'Properties',
    text: 'Whatever is selected, its numbers live here: exact position, size, rotation, colour and material. Type a value when dragging is not precise enough.',
    side: 'left',
    align: 'start',
  },
  {
    target: '[data-tour="view-toggle"]',
    title: 'Plan and 3D — keys 1 and 2',
    text: 'The same model, two ways of looking at it. Nothing is regenerated when you switch, so a wall you moved a second ago is already in the walkthrough.',
    side: 'bottom',
    align: 'center',
  },
  {
    target: '[data-tour="canvas"]',
    title: 'Moving around in 3D',
    text: 'Left-drag or middle-drag orbits, <b>Shift</b>+middle-drag pans, the wheel zooms toward the cursor. Numpad <b>1</b>, <b>3</b>, <b>7</b> jump to front, right and top, and <b>.</b> frames whatever is selected.',
    prepare: async () => {
      useEditorStore.getState().setView('3d');
      await settle(900);
    },
  },
  {
    target: '[data-tour="canvas"]',
    title: 'Rotating and moving, Blender style',
    text: 'Select a piece, then <b>G</b> to grab, <b>R</b> to rotate, <b>S</b> to scale. Press <b>X</b> or <b>Y</b> to lock an axis, type a number for an exact value, then click or press <b>Enter</b> to confirm — <b>Esc</b> puts it back.',
  },
  {
    target: '[data-tour="transform-modes"]',
    title: 'Or use the handles',
    text: 'Prefer the mouse? Switch between Move, Rotate and Scale and drag the on-screen handles attached to the selected piece.',
    side: 'bottom',
    align: 'end',
  },
  {
    target: '[data-tour="camera-presets"]',
    title: 'Viewpoints and lighting',
    text: 'Perspective, top-down, isometric and front views, each an eased flight rather than a jump. The dropdown relights the scene: daylight, evening, warm or studio.',
    side: 'bottom',
    align: 'center',
  },
  {
    target: '[data-tour="floors"]',
    title: 'Floors',
    text: 'Add a storey, switch between them, or hide one in the 3D view to look inside the floor below. Each floor keeps its own walls, rooms and furniture.',
    side: 'top',
    align: 'end',
    prepare: async () => {
      useEditorStore.getState().setView('2d');
      await settle(500);
    },
  },
  {
    target: '[data-tour="units"]',
    title: 'Units',
    text: 'Metres, centimetres or feet. Every field and every dimension label follows your choice; the model itself is always stored in metres.',
    side: 'top',
    align: 'end',
  },
  {
    target: '[data-tour="history"]',
    title: 'Undo and redo',
    text: 'Every change is one step with an exact inverse, so <b>Ctrl+Z</b> walks back precisely — including a drag, a material change or a whole template insert.',
    side: 'bottom',
    align: 'center',
  },
  {
    target: '[data-tour="save"]',
    title: 'Saving',
    text: 'Work saves itself: to this browser within half a second, and to your account a moment later. <b>Ctrl+S</b> forces it now. The label tells you which of the two happened.',
    side: 'bottom',
    align: 'center',
  },
  {
    target: '[data-tour="export"]',
    title: 'Import and export',
    text: 'Take a PNG snapshot of the current view, download the whole project as JSON to archive or hand over, or import a JSON file someone sent you — it opens as a new project, never overwriting one.',
    side: 'bottom',
    align: 'end',
  },
  {
    target: '[data-tour="share"]',
    title: 'Sharing with a client',
    text: 'Create a read-only link: name the recipient, set an expiry and an optional passcode. They open it in any browser with no account, watermarked, with no way to edit, download or print.',
    side: 'bottom',
    align: 'end',
  },
  {
    target: '[data-tour="help"]',
    title: 'That is the whole studio',
    text: 'Every shortcut is listed under this button, and <b>Take the tour</b> there brings this back any time. Now pick a template and move a wall — it is the fastest way to get the feel of it.',
    side: 'bottom',
    align: 'end',
  },
];

function toDriveSteps(stops: Stop[], onPrepare: (stop: Stop) => Promise<void>): DriveStep[] {
  return stops.map((stop) => ({
    element: stop.target,
    popover: {
      title: stop.title,
      description: stop.text,
      side: stop.side,
      align: stop.align ?? 'center',
      onPopoverRender: () => {
        void onPrepare(stop);
      },
    },
  }));
}

let active: Driver | null = null;

/** Starts the editor tour. Safe to call twice; the second call restarts it. */
export async function startEditorTour(): Promise<void> {
  active?.destroy();

  // A read-only session has no tools to tour, so it gets the short version.
  const stops = sessionCan('edit') ? EDITOR_STOPS : VIEWER_STOPS;

  // Panels have to be open for their steps to have something to point at.
  const ui = useUiStore.getState();
  if (sessionCan('edit')) {
    if (!ui.leftOpen) ui.toggleLeft();
    if (!ui.rightOpen) ui.toggleRight();
  }
  const returnTo = useEditorStore.getState().view;
  const returnTool = useEditorStore.getState().tool;

  await stops[0].prepare?.();

  const instance = driver({
    showProgress: true,
    progressText: 'Step {{current}} of {{total}}',
    nextBtnText: 'Next →',
    prevBtnText: '← Back',
    doneBtnText: 'Finish',
    showButtons: ['next', 'previous', 'close'],
    allowClose: true,
    overlayColor: '#05070c',
    overlayOpacity: 0.72,
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: 'interior-tour',
    steps: toDriveSteps(stops, async (stop) => {
      await stop.prepare?.();
    }),
    onDestroyed: () => {
      // Put the editor back the way we found it.
      useEditorStore.getState().setView(returnTo);
      useEditorStore.getState().setTool(returnTool);
      markTourSeen();
      active = null;
    },
  });

  active = instance;
  instance.drive();
}

/** Three stops for someone opening a client link — no tools, just how to look. */
const VIEWER_STOPS: Stop[] = [
  {
    target: '[data-tour="canvas"]',
    title: 'Welcome — this is the design',
    text: 'Scroll to zoom, hold <b>Space</b> and drag to move around, and click anything to see its size. Nothing you do here can change the drawing.',
  },
  {
    target: '[data-tour="view-toggle"]',
    title: 'Walk through it in 3D',
    text: 'Switch to <b>3D</b> for a walkthrough of the same design — left-drag to look around, scroll to zoom. Press <b>1</b> and <b>2</b> to flip between the two.',
    side: 'bottom',
    align: 'center',
  },
  {
    target: '[data-tour="right-panel"]',
    title: 'The numbers',
    text: 'Room-by-room areas, the total carpet area and everything placed in the design. Send any comments straight back to your designer — changes are made on their copy.',
    side: 'left',
    align: 'start',
  },
];

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // Storage blocked: never nag.
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function resetTour(): void {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* ignore */
  }
}
