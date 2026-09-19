import type { Command } from './commands';

export interface HistoryEntry {
  id: number;
  label: string;
  applied: Command;
  inverse: Command;
}

export interface HistoryState {
  entries: HistoryEntry[];
  index: number;
}

export const initialHistory = (): HistoryState => ({ entries: [], index: -1 });

export function pushHistory(state: HistoryState, entry: HistoryEntry): HistoryState {
  // Truncate any redo branch.
  const entries = state.entries.slice(0, state.index + 1);
  entries.push(entry);
  return { entries, index: entries.length - 1 };
}

export function canUndo(state: HistoryState): boolean {
  return state.index >= 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.index < state.entries.length - 1;
}

/** Next command to run when undoing (the inverse of the entry at `index`). */
export function undoCommand(state: HistoryState): Command | null {
  if (!canUndo(state)) return null;
  return state.entries[state.index].inverse;
}

export function redoCommand(state: HistoryState): Command | null {
  if (!canRedo(state)) return null;
  return state.entries[state.index + 1].applied;
}

export function undoHistory(state: HistoryState): HistoryState {
  if (!canUndo(state)) return state;
  return { ...state, index: state.index - 1 };
}

export function redoHistory(state: HistoryState): HistoryState {
  if (!canRedo(state)) return state;
  return { ...state, index: state.index + 1 };
}