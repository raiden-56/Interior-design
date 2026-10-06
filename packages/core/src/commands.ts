import type { Door, Floor, Project, ProjectObject, Room, Wall, Window } from './types';

/**
 * Command system.
 *
 * Every mutation to the canonical project model flows through `applyCommand`,
 * which produces the next immutable project state PLUS the exact inverse
 * command needed for undo. History stores command pairs, not snapshots.
 */

export type Command =
  | { type: 'BATCH'; label: string; commands: Command[] }
  | { type: 'ADD_WALL'; floorId?: string; wall: Wall }
  | { type: 'UPDATE_WALL'; floorId?: string; id: string; patch: Partial<Wall> }
  | { type: 'DELETE_WALL'; floorId?: string; id: string }
  | { type: 'ADD_DOOR'; floorId?: string; door: Door }
  | { type: 'UPDATE_DOOR'; floorId?: string; id: string; patch: Partial<Door> }
  | { type: 'DELETE_DOOR'; floorId?: string; id: string }
  | { type: 'ADD_WINDOW'; floorId?: string; window: Window }
  | { type: 'UPDATE_WINDOW'; floorId?: string; id: string; patch: Partial<Window> }
  | { type: 'DELETE_WINDOW'; floorId?: string; id: string }
  | { type: 'ADD_ROOM'; floorId?: string; room: Room }
  | { type: 'UPDATE_ROOM'; floorId?: string; id: string; patch: Partial<Room> }
  | { type: 'DELETE_ROOM'; floorId?: string; id: string }
  | { type: 'ADD_OBJECT'; floorId?: string; object: ProjectObject }
  | { type: 'UPDATE_OBJECT'; floorId?: string; id: string; patch: Partial<ProjectObject> }
  | { type: 'DELETE_OBJECT'; floorId?: string; id: string }
  | { type: 'ADD_FLOOR'; floor: Floor }
  | { type: 'UPDATE_FLOOR'; id: string; patch: Partial<Floor> }
  | { type: 'DELETE_FLOOR'; id: string }
  | {
      type: 'UPDATE_PROJECT';
      patch: Partial<Pick<Project, 'name' | 'units' | 'floorHeight' | 'walkthrough'>>;
    };

export interface CommandResult {
  project: Project;
  inverse: Command;
}

function cloneWall(w: Wall): Wall {
  return { ...w, a: { ...w.a }, b: { ...w.b } };
}
function cloneDoor(d: Door): Door {
  return { ...d };
}
function cloneWindow(w: Window): Window {
  return { ...w };
}
function cloneRoom(r: Room): Room {
  return { ...r, points: r.points.map((p) => ({ ...p })) };
}
function cloneObject(o: ProjectObject): ProjectObject {
  return { ...o };
}
function cloneFloor(f: Floor): Floor {
  return {
    ...f,
    walls: f.walls.map(cloneWall),
    doors: f.doors.map(cloneDoor),
    windows: f.windows.map(cloneWindow),
    rooms: f.rooms.map(cloneRoom),
    objects: f.objects.map(cloneObject),
  };
}

export function cloneProject(p: Project): Project {
  return {
    ...p,
    floors: p.floors.map(cloneFloor),
    updatedAt: Date.now(),
  };
}

/**
 * Apply a command to a project. Returns the new project and the exact inverse
 * command. Every branch captures the previous values needed for undo.
 */
export function applyCommand(project: Project, command: Command): CommandResult {
  const next = cloneProject(project);

  if (command.type === 'BATCH') {
    const inverses: Command[] = [];
    let running = next;
    for (const sub of command.commands) {
      const res = applyCommand(running, sub);
      running = res.project;
      inverses.unshift(res.inverse);
    }
    return {
      project: running,
      inverse: { type: 'BATCH', label: command.label, commands: inverses } as Command,
    };
  }

  if (command.type === 'UPDATE_PROJECT') {
    const prev: Partial<Pick<Project, 'name' | 'units' | 'floorHeight' | 'walkthrough'>> = {
      name: next.name,
      units: next.units,
      floorHeight: next.floorHeight,
    };
    // Only captured when touched, so an unrelated rename does not pin an
    // `undefined` walkthrough block onto its inverse.
    if ('walkthrough' in command.patch) prev.walkthrough = next.walkthrough;
    Object.assign(next, command.patch);
    return { project: next, inverse: { type: 'UPDATE_PROJECT', patch: prev } };
  }

  if (command.type === 'ADD_FLOOR') {
    next.floors.push(command.floor);
    return { project: next, inverse: { type: 'DELETE_FLOOR', id: command.floor.id } };
  }

  if (command.type === 'DELETE_FLOOR') {
    const idx = next.floors.findIndex((f) => f.id === command.id);
    const removed = idx >= 0 ? next.floors[idx] : null;
    if (idx >= 0) next.floors.splice(idx, 1);
    if (removed) {
      return { project: next, inverse: { type: 'ADD_FLOOR', floor: removed } };
    }
    return { project: next, inverse: command };
  }

  if (command.type === 'UPDATE_FLOOR') {
    const floor = next.floors.find((f) => f.id === command.id);
    if (!floor) return { project: next, inverse: command };
    const prev = capturePartial(floor, Object.keys(command.patch) as (keyof Floor)[]);
    Object.assign(floor, command.patch);
    return { project: next, inverse: { type: 'UPDATE_FLOOR', id: command.id, patch: prev } };
  }

  // Entity commands target a specific floor (defaults to the first floor).
  const targetFloorId = (command as { floorId?: string }).floorId;
  const floorIdx = targetFloorId ? next.floors.findIndex((f) => f.id === targetFloorId) : 0;
  if (floorIdx < 0) return { project: next, inverse: command };
  const floor = next.floors[floorIdx];
  const fid = floor.id;

  const inv = (c: Command): Command => ({ ...c, floorId: fid }) as Command;

  switch (command.type) {
    case 'ADD_WALL': {
      const w = cloneWall(command.wall);
      floor.walls.push(w);
      return { project: next, inverse: inv({ type: 'DELETE_WALL', id: w.id }) };
    }
    case 'UPDATE_WALL': {
      const w = floor.walls.find((ww) => ww.id === command.id);
      if (!w) return { project: next, inverse: command };
      const prev = capturePartial(w, Object.keys(command.patch) as (keyof Wall)[]);
      Object.assign(w, command.patch);
      return { project: next, inverse: inv({ type: 'UPDATE_WALL', id: command.id, patch: prev }) };
    }
    case 'DELETE_WALL': {
      const idx = floor.walls.findIndex((ww) => ww.id === command.id);
      if (idx < 0) return { project: next, inverse: command };
      const removed = floor.walls[idx];
      floor.walls.splice(idx, 1);
      floor.doors = floor.doors.filter((d) => d.wallId !== command.id);
      floor.windows = floor.windows.filter((wn) => wn.wallId !== command.id);
      return { project: next, inverse: inv({ type: 'ADD_WALL', wall: removed }) };
    }

    case 'ADD_DOOR':
      floor.doors.push(command.door);
      return { project: next, inverse: inv({ type: 'DELETE_DOOR', id: command.door.id }) };
    case 'UPDATE_DOOR': {
      const d = floor.doors.find((x) => x.id === command.id);
      if (!d) return { project: next, inverse: command };
      const prev: Partial<Door> = { ...d };
      Object.assign(d, command.patch);
      return { project: next, inverse: inv({ type: 'UPDATE_DOOR', id: command.id, patch: prev }) };
    }
    case 'DELETE_DOOR': {
      const idx = floor.doors.findIndex((x) => x.id === command.id);
      if (idx < 0) return { project: next, inverse: command };
      const removed = floor.doors[idx];
      floor.doors.splice(idx, 1);
      return { project: next, inverse: inv({ type: 'ADD_DOOR', door: removed }) };
    }

    case 'ADD_WINDOW': {
      // Keep windows sorted by offset so 3D opening reconstruction is clean.
      const insert = floor.windows.findIndex((w) => w.offset > command.window.offset);
      if (insert < 0) floor.windows.push(command.window);
      else floor.windows.splice(insert, 0, command.window);
      return { project: next, inverse: inv({ type: 'DELETE_WINDOW', id: command.window.id }) };
    }
    case 'UPDATE_WINDOW': {
      const w = floor.windows.find((x) => x.id === command.id);
      if (!w) return { project: next, inverse: command };
      const prev: Partial<Window> = { ...w };
      Object.assign(w, command.patch);
      return { project: next, inverse: inv({ type: 'UPDATE_WINDOW', id: command.id, patch: prev }) };
    }
    case 'DELETE_WINDOW': {
      const idx = floor.windows.findIndex((x) => x.id === command.id);
      if (idx < 0) return { project: next, inverse: command };
      const removed = floor.windows[idx];
      floor.windows.splice(idx, 1);
      return { project: next, inverse: inv({ type: 'ADD_WINDOW', window: removed }) };
    }

    case 'ADD_ROOM':
      floor.rooms.push(command.room);
      return { project: next, inverse: inv({ type: 'DELETE_ROOM', id: command.room.id }) };
    case 'UPDATE_ROOM': {
      const r = floor.rooms.find((x) => x.id === command.id);
      if (!r) return { project: next, inverse: command };
      const prev: Partial<Room> = { ...r, points: r.points.map((p) => ({ ...p })) };
      Object.assign(r, command.patch);
      return { project: next, inverse: inv({ type: 'UPDATE_ROOM', id: command.id, patch: prev }) };
    }
    case 'DELETE_ROOM': {
      const idx = floor.rooms.findIndex((x) => x.id === command.id);
      if (idx < 0) return { project: next, inverse: command };
      const removed = floor.rooms[idx];
      floor.rooms.splice(idx, 1);
      return { project: next, inverse: inv({ type: 'ADD_ROOM', room: removed }) };
    }

    case 'ADD_OBJECT':
      floor.objects.push(command.object);
      return { project: next, inverse: inv({ type: 'DELETE_OBJECT', id: command.object.id }) };
    case 'UPDATE_OBJECT': {
      const o = floor.objects.find((x) => x.id === command.id);
      if (!o) return { project: next, inverse: command };
      const prev: Partial<ProjectObject> = { ...o };
      Object.assign(o, command.patch);
      return { project: next, inverse: inv({ type: 'UPDATE_OBJECT', id: command.id, patch: prev }) };
    }
    case 'DELETE_OBJECT': {
      const idx = floor.objects.findIndex((x) => x.id === command.id);
      if (idx < 0) return { project: next, inverse: command };
      const removed = floor.objects[idx];
      floor.objects.splice(idx, 1);
      return { project: next, inverse: inv({ type: 'ADD_OBJECT', object: removed }) };
    }

    default:
      return { project: next, inverse: command };
  }
}

/** Deep-ish clone of the patch-relevant current values so inverse commands are independent snapshots. */
function capturePartial<T extends object>(src: T, keys: (keyof T)[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (src as Record<string, unknown>)[k as string];
    out[k as string] = v !== null && typeof v === 'object'
      ? Array.isArray(v)
        ? v.map((x) => (x && typeof x === 'object' ? { ...(x as object) } : x))
        : { ...(v as object) }
      : v;
  }
  return out as Partial<T>;
}

/** Re-parent a command to a specific floor (entity commands only). */
export function withFloorId(cmd: Command, floorId: string): Command {
  if (cmd.type === 'BATCH') {
    return { type: 'BATCH', label: cmd.label, commands: cmd.commands.map((c) => withFloorId(c, floorId)) };
  }
  switch (cmd.type) {
    case 'ADD_WALL':
    case 'UPDATE_WALL':
    case 'DELETE_WALL':
    case 'ADD_DOOR':
    case 'UPDATE_DOOR':
    case 'DELETE_DOOR':
    case 'ADD_WINDOW':
    case 'UPDATE_WINDOW':
    case 'DELETE_WINDOW':
    case 'ADD_ROOM':
    case 'UPDATE_ROOM':
    case 'DELETE_ROOM':
    case 'ADD_OBJECT':
    case 'UPDATE_OBJECT':
    case 'DELETE_OBJECT':
      return { ...cmd, floorId } as Command;
    default:
      return cmd;
  }
}

/** Human-readable label for history / toasts. */
export const commandLabel = (command: Command): string => {
  const map: Record<string, string> = {
    ADD_WALL: 'Add wall',
    UPDATE_WALL: 'Edit wall',
    DELETE_WALL: 'Delete wall',
    ADD_DOOR: 'Add door',
    UPDATE_DOOR: 'Edit door',
    DELETE_DOOR: 'Delete door',
    ADD_WINDOW: 'Add window',
    UPDATE_WINDOW: 'Edit window',
    DELETE_WINDOW: 'Delete window',
    ADD_ROOM: 'Add room',
    UPDATE_ROOM: 'Edit room',
    DELETE_ROOM: 'Delete room',
    ADD_OBJECT: 'Add object',
    UPDATE_OBJECT: 'Edit object',
    DELETE_OBJECT: 'Delete object',
    ADD_FLOOR: 'Add floor',
    UPDATE_FLOOR: 'Edit floor',
    DELETE_FLOOR: 'Delete floor',
    UPDATE_PROJECT: 'Edit project',
  };
  if (command.type === 'BATCH') return command.label;
  return map[command.type] ?? command.type;
};