import { create } from 'zustand';
import type {
  Project,
  Floor,
  Command,
  Door,
  Window,
  Wall,
  Room,
  ProjectObject,
  HistoryState,
  Vec2,
} from '@interior/core';
import {
  applyCommand,
  cloneProject,
  commandLabel,
  createProject,
  createFloor,
  withFloorId,
  initialHistory,
  pushHistory,
  undoCommand,
  redoCommand,
  canUndo,
  canRedo,
  wallLength,
  pointOnWall,
  wallDir,
  analyseFloor,
  gridStep,
} from '@interior/core';
import type { CollisionWarning } from '@interior/core';
import { saveProjectLocal, deleteProjectLocal, remoteSave, remoteDelete, downloadProject } from '@/lib/storage';
import { useUiStore } from '@/stores/ui-store';
import { sessionCan } from '@/stores/session-store';
import type { PlanEditor2D } from '@/components/editor/PlanEditor2D';

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'room' | 'pan' | 'measure';
export type ViewMode = '2d' | '3d';
/** Where the last save landed. Drives the status pill in the top bar. */
export type SyncState = 'idle' | 'saving' | 'local' | 'synced' | 'offline';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface SelectionInfo {
  kind: 'wall' | 'door' | 'window' | 'room' | 'object';
  id: string;
  floorId: string;
  item: Wall | Door | Window | Room | ProjectObject;
}

interface EditorState {
  project: Project;
  activeFloorId: string;
  view: ViewMode;
  tool: Tool;
  selection: string[];
  history: HistoryState;
  toasts: Toast[];
  savedAt: number | null;
  /** True when the model has changed since the last local save. */
  dirty: boolean;
  syncState: SyncState;
  backendLive: boolean | null;
  warnings: string[];
  collisionWarnings: CollisionWarning[];
  editor2D: PlanEditor2D | null;

  // project / floors
  createNewProject: () => void;
  loadProject: (p: Project) => void;
  updateProjectInfo: (patch: { name?: string; units?: Project['units']; floorHeight?: number }) => void;
  addFloor: (name: string) => string;
  deleteFloor: (floorId: string) => void;
  updateFloor: (floorId: string, patch: Partial<Floor>) => void;
  toggleFloorVisible: (floorId: string) => void;
  setActiveFloor: (floorId: string) => void;

  // commands / history
  run: (command: Command, label?: string) => void;
  runBatch: (elements: { command: Command; label: string }[], label: string) => void;
  undo: () => void;
  redo: () => void;
  getUndoLabel: () => string | null;
  getRedoLabel: () => string | null;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // selection / tools / view
  setTool: (t: Tool) => void;
  setView: (v: ViewMode) => void;
  select: (ids: string[]) => void;
  selectionInfo: () => SelectionInfo[];
  setEditor2D: (e: PlanEditor2D | null) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  nudgeSelection: (dx: number, dz: number) => void;
  rotateSelection: (deltaRadians: number) => void;
  /** Escape: drop drafts, pending placements, measurements and the selection. */
  cancelInteraction: () => void;

  // persistence
  save: () => void;
  saveNow: () => Promise<void>;
  scheduleSave: () => void;
  deleteProject: (projectId: string) => Promise<void>;
  exportJson: () => void;
  pushToast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

let toastCounter = 0;
let localSaveTimer: ReturnType<typeof setTimeout> | null = null;
let remoteSaveTimer: ReturnType<typeof setTimeout> | null = null;

const LOCAL_SAVE_DELAY_MS = 400;
/** Longer than the local debounce so a slider drag becomes one network write, not dozens. */
const REMOTE_SAVE_DELAY_MS = 1500;

function analyseActive(project: Project, activeFloorId: string): CollisionWarning[] {
  const floor = project.floors.find((f) => f.id === activeFloorId);
  return floor ? analyseFloor(floor) : [];
}

function warnTexts(list: CollisionWarning[]): string[] {
  const errors = list.filter((w) => w.level === 'error').length;
  return errors > 0 ? [`${errors} collision${errors > 1 ? 's' : ''} detected`] : [];
}

function makeSelectionInfo(project: Project, activeFloorId: string, ids: string[]): SelectionInfo[] {
  const floor = project.floors.find((f) => f.id === activeFloorId);
  if (!floor) return [];
  const out: SelectionInfo[] = [];
  for (const id of ids) {
    const wall = floor.walls.find((w) => w.id === id);
    if (wall) {
      out.push({ kind: 'wall', id, floorId: floor.id, item: wall });
      continue;
    }
    const door = floor.doors.find((d) => d.id === id);
    if (door) {
      out.push({ kind: 'door', id, floorId: floor.id, item: door });
      continue;
    }
    const window = floor.windows.find((w) => w.id === id);
    if (window) {
      out.push({ kind: 'window', id, floorId: floor.id, item: window });
      continue;
    }
    const room = floor.rooms.find((r) => r.id === id);
    if (room) {
      out.push({ kind: 'room', id, floorId: floor.id, item: room });
      continue;
    }
    const object = floor.objects.find((o) => o.id === id);
    if (object) {
      out.push({ kind: 'object', id, floorId: floor.id, item: object });
    }
  }
  return out;
}

function activeFloorOf(state: { project: Project; activeFloorId: string }): Floor {
  return state.project.floors.find((f) => f.id === state.activeFloorId) ?? state.project.floors[0];
}

const initialProject = createProject('Untitled Project');

export const useEditorStore = create<EditorState>()((set, get) => ({
  project: initialProject,
  activeFloorId: initialProject.floors[0].id,
  view: '2d',
  tool: 'select',
  selection: [],
  history: initialHistory(),
  toasts: [],
  savedAt: null,
  dirty: false,
  syncState: 'idle',
  backendLive: null,
  warnings: [],
  collisionWarnings: [],
  editor2D: null,

  createNewProject: () => {
    const p = createProject();
    set({ project: p, activeFloorId: p.floors[0].id, selection: [], history: initialHistory(), warnings: [], collisionWarnings: [] });
    void get().saveNow();
  },

  loadProject: (p) => {
    const id = p.floors[0]?.id ?? '';
    const cw = analyseActive(p, id);
    set({
      project: p,
      activeFloorId: id,
      selection: [],
      history: initialHistory(),
      warnings: warnTexts(cw),
      collisionWarnings: cw,
      dirty: false,
      savedAt: p.updatedAt,
      syncState: 'idle',
    });
  },

  /**
   * Metadata edits (name, units, floor height) bypass the command history.
   * Typing a project name used to push one undo entry per keystroke, so
   * Ctrl+Z after renaming walked back through the name letter by letter
   * instead of undoing the last design change.
   */
  updateProjectInfo: (patch) => {
    if (!sessionCan('edit')) return;
    const { project } = get();
    set({ project: cloneProject({ ...project, ...patch }) });
    get().scheduleSave();
  },

  addFloor: (name) => {
    const { project, activeFloorId } = get();
    const index = Math.max(project.floors.findIndex((f) => f.id === activeFloorId), 0);
    const floor = createFloor(name);
    floor.height = project.floorHeight;
    floor.elevation = index >= 0 ? project.floors[index].elevation + project.floorHeight : 0;
    set({
      project: cloneProject({ ...project, floors: [...project.floors.slice(0, index + 1), floor, ...project.floors.slice(index + 1)] }),
      activeFloorId: floor.id,
      selection: [],
    });
    get().scheduleSave();
    return floor.id;
  },

  deleteFloor: (floorId) => {
    const { project } = get();
    if (project.floors.length <= 1) {
      get().pushToast('Cannot delete the last floor', 'error');
      return;
    }
    get().run({ type: 'DELETE_FLOOR', id: floorId }, 'Delete floor');
    const { project: next } = get();
    if (get().activeFloorId === floorId) {
      const idx = next.floors.findIndex((f) => f.id === floorId);
      const fallback = next.floors[Math.max(Math.min(idx, next.floors.length - 1), 0)];
      set({ activeFloorId: fallback.id });
    }
  },

  updateFloor: (floorId, patch) => {
    get().run({ type: 'UPDATE_FLOOR', id: floorId, patch }, 'Edit floor');
  },

  toggleFloorVisible: (floorId) => {
    const floor = get().project.floors.find((f) => f.id === floorId);
    if (!floor) return;
    get().run({ type: 'UPDATE_FLOOR', id: floorId, patch: { visible: !floor.visible } }, floor.visible ? 'Hide floor' : 'Show floor');
  },

  setActiveFloor: (floorId) => {
    const cw = analyseActive(get().project, floorId);
    set({ activeFloorId: floorId, selection: [], warnings: warnTexts(cw), collisionWarnings: cw });
  },

  run: (command, label) => {
    // The one place every mutation passes through. A read-only session is
    // refused here rather than by hiding buttons, so a stray keyboard
    // shortcut or a leftover handler cannot change a client's copy.
    if (!sessionCan('edit')) {
      get().pushToast('This is a read-only view', 'info');
      return;
    }
    const { project, history, activeFloorId } = get();
    const targeted = withFloorId(command, activeFloorId);
    const result = applyCommand(project, targeted);
    const entry = { id: Date.now(), label: label ?? commandLabel(targeted), applied: targeted, inverse: result.inverse };
    const cw = analyseActive(result.project, activeFloorId);
    set({
      project: result.project,
      history: pushHistory(history, entry),
      warnings: warnTexts(cw),
      collisionWarnings: cw,
    });
    get().scheduleSave();
  },

  runBatch: (elements, label) => {
    const batch: Command = {
      type: 'BATCH',
      label,
      commands: elements.map((e) => e.command),
    };
    get().run(batch, label);
  },

  undo: () => {
    if (!sessionCan('edit')) return;
    const { history, project } = get();
    const cmd = undoCommand(history);
    if (!cmd) return;
    const result = applyCommand(project, cmd);
    const activeFloorId = get().activeFloorId;
    const cw = analyseActive(result.project, activeFloorId);
    set({
      project: result.project,
      history: { entries: history.entries, index: history.index - 1 },
      selection: [],
      warnings: warnTexts(cw),
      collisionWarnings: cw,
    });
    get().scheduleSave();
  },

  redo: () => {
    if (!sessionCan('edit')) return;
    const { history, project } = get();
    const cmd = redoCommand(history);
    if (!cmd) return;
    const result = applyCommand(project, cmd);
    const activeFloorId = get().activeFloorId;
    const cw = analyseActive(result.project, activeFloorId);
    set({
      project: result.project,
      history: { entries: history.entries, index: history.index + 1 },
      selection: [],
      warnings: warnTexts(cw),
      collisionWarnings: cw,
    });
    get().scheduleSave();
  },

  getUndoLabel: () => {
    const { history } = get();
    if (!canUndo(history)) return null;
    return history.entries[history.index].label;
  },

  getRedoLabel: () => {
    const { history } = get();
    if (!canRedo(history)) return null;
    return history.entries[history.index + 1].label;
  },

  canUndo: () => canUndo(get().history),
  canRedo: () => canRedo(get().history),

  setTool: (t) => set({ tool: t, selection: t === 'select' ? get().selection : [] }),
  setView: (v) => set({ view: v }),
  select: (ids) => set({ selection: ids }),
  selectionInfo: () => makeSelectionInfo(get().project, get().activeFloorId, get().selection),
  setEditor2D: (e) => set({ editor2D: e }),

  deleteSelection: () => {
    const state = get();
    if (state.selection.length === 0) return;
    const floor = activeFloorOf(state);
    const commands: Command[] = [];
    for (const id of state.selection) {
      if (floor.walls.some((w) => w.id === id)) commands.push({ type: 'DELETE_WALL', id });
      else if (floor.doors.some((d) => d.id === id)) commands.push({ type: 'DELETE_DOOR', id });
      else if (floor.windows.some((w) => w.id === id)) commands.push({ type: 'DELETE_WINDOW', id });
      else if (floor.rooms.some((r) => r.id === id)) commands.push({ type: 'DELETE_ROOM', id });
      else if (floor.objects.some((o) => o.id === id)) commands.push({ type: 'DELETE_OBJECT', id });
    }
    if (commands.length === 0) return;
    state.run({ type: 'BATCH', label: commands.length > 1 ? 'Delete selection' : commandLabel(commands[0]), commands });
    set({ selection: [] });
  },

  duplicateSelection: () => {
    const state = get();
    const floor = activeFloorOf(state);
    const step = gridStep(state.project.units) * 2;
    const clones: ProjectObject[] = [];
    for (const id of state.selection) {
      const o = floor.objects.find((x) => x.id === id);
      if (!o) continue;
      clones.push({ ...o, id: 'obj-' + Math.random().toString(36).slice(2, 9), x: o.x + step, z: o.z + step });
    }
    if (clones.length === 0) {
      state.pushToast('Select furniture to duplicate', 'info');
      return;
    }
    state.run(
      { type: 'BATCH', label: clones.length > 1 ? `Duplicate ${clones.length} objects` : `Duplicate ${clones[0].name}`, commands: clones.map((o) => ({ type: 'ADD_OBJECT', object: o })) },
    );
    set({ selection: clones.map((c) => c.id) });
  },

  nudgeSelection: (dx, dz) => {
    const state = get();
    const floor = activeFloorOf(state);
    const commands: Command[] = [];
    for (const id of state.selection) {
      const o = floor.objects.find((x) => x.id === id);
      if (o) commands.push({ type: 'UPDATE_OBJECT', id, patch: { x: round2(o.x + dx), z: round2(o.z + dz) } });
    }
    if (commands.length === 0) return;
    state.run({ type: 'BATCH', label: 'Move', commands });
  },

  rotateSelection: (delta) => {
    const state = get();
    const floor = activeFloorOf(state);
    const commands: Command[] = [];
    for (const id of state.selection) {
      const o = floor.objects.find((x) => x.id === id);
      if (o) commands.push({ type: 'UPDATE_OBJECT', id, patch: { rotation: normalizeAngle(o.rotation + delta) } });
    }
    if (commands.length === 0) return;
    state.run({ type: 'BATCH', label: 'Rotate', commands });
  },

  cancelInteraction: () => {
    get().editor2D?.cancelDraft();
    const ui = useUiStore.getState();
    if (ui.pendingAsset) ui.setPendingAsset(null);
    if (ui.measureWidget.from || ui.measureWidget.to) ui.setMeasure({ from: null, to: null, active: false });
    set({ selection: [] });
  },

  save: () => {
    if (!sessionCan('edit')) return;
    try {
      saveProjectLocal(get().project);
      set({ savedAt: Date.now(), dirty: false, syncState: get().backendLive ? get().syncState : 'local' });
    } catch (err) {
      get().pushToast(err instanceof Error ? err.message : 'Could not save', 'error');
    }
  },

  saveNow: async () => {
    if (!sessionCan('edit')) return;
    if (localSaveTimer) clearTimeout(localSaveTimer);
    if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
    get().save();
    set({ syncState: 'saving' });
    const ok = await remoteSave(get().project);
    set({ backendLive: ok, syncState: ok ? 'synced' : 'local' });
  },

  /**
   * Two debounces: a short one to localStorage (never lose work) and a longer
   * one to the backend (don't hammer it during a drag). Previously nothing
   * after project creation ever reached the backend at all.
   */
  scheduleSave: () => {
    if (!sessionCan('edit')) return;
    set({ dirty: true });
    if (localSaveTimer) clearTimeout(localSaveTimer);
    localSaveTimer = setTimeout(() => get().save(), LOCAL_SAVE_DELAY_MS);

    if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
    remoteSaveTimer = setTimeout(async () => {
      set({ syncState: 'saving' });
      const ok = await remoteSave(get().project);
      set({ backendLive: ok, syncState: ok ? 'synced' : 'local' });
    }, REMOTE_SAVE_DELAY_MS);
  },

  deleteProject: async (projectId) => {
    if (!sessionCan('remove')) return;
    deleteProjectLocal(projectId);
    await remoteDelete(projectId);
  },

  exportJson: () => {
    if (!sessionCan('exportFiles')) {
      get().pushToast('Downloads are disabled on this link', 'info');
      return;
    }
    downloadProject(get().project);
  },

  pushToast: (text, kind = 'info') => {
    toastCounter += 1;
    const toast: Toast = { id: toastCounter, text, kind };
    set({ toasts: [...get().toasts, toast] });
    setTimeout(() => get().dismissToast(toast.id), 2600);
  },

  dismissToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

// --- derived selectors ------------------------------------------------------

export const useActiveFloor = () =>
  useEditorStore((s) => s.project.floors.find((f) => f.id === s.activeFloorId) ?? s.project.floors[0]);

export const useSelectionInfo = () => useEditorStore((s) => s.selection.length);

export function computeWallLengths(floor: Floor): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of floor.walls) m.set(w.id, wallLength(w));
  return m;
}

export function localPointOf(wall: Wall, t: number): Vec2 {
  return pointOnWall(wall, t);
}

/** Door/window centered position helper shared by panels */
export function anchorCenter(wall: Wall, offset: number, width: number): Vec2 {
  const d = wallDir(wall);
  return { x: wall.a.x + d.x * (offset + width / 2), y: wall.a.y + d.y * (offset + width / 2) };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  if (r < -Math.PI) r += twoPi;
  return Math.round(r * 1000) / 1000;
}

export type { Project, Floor };
