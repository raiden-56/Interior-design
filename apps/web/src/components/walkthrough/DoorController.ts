/**
 * Door state for the walkthrough: which doors are open, how far, and whether
 * one blocks the player right now.
 *
 * This is runtime state, not model state. The project only records a door's
 * *behaviour* (manual, automatic, always open, locked); whether it happens to
 * be standing open while someone walks through is forgotten the moment the
 * walkthrough ends, exactly like a light left on in a showroom.
 */

import type { Project } from '@interior/core';
import { doorBehavior, pointOnWall, type DoorBehavior } from '@interior/core';

/** Fully open, radians. Short of 90° so the leaf never clips the next wall. */
export const DOOR_OPEN_ANGLE = 1.5;
/** Seconds for a full swing. */
export const DOOR_SWING_SECONDS = 0.7;
export const AUTO_OPEN_RADIUS = 1.6;
export const AUTO_CLOSE_RADIUS = 2.4;

export interface DoorRuntime {
  id: string;
  floorId: string;
  behavior: DoorBehavior;
  /** Linear 0..1 progress; `open` below is the eased value used for drawing. */
  t: number;
  target: 0 | 1;
  /** World centre of the opening and the floor level it stands on. */
  x: number;
  z: number;
  y: number;
  width: number;
}

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class DoorController {
  private doors = new Map<string, DoorRuntime>();
  private autoAll = false;

  constructor(project: Project, opts: { autoDoors?: boolean } = {}) {
    this.autoAll = !!opts.autoDoors;
    this.sync(project);
  }

  /** Reconciles with the project: new doors appear closed, deleted ones vanish, behaviours update. */
  sync(project: Project): void {
    const seen = new Set<string>();
    for (const floor of project.floors) {
      if (!floor.visible) continue;
      for (const d of floor.doors) {
        const wall = floor.walls.find((w) => w.id === d.wallId);
        if (!wall) continue;
        const c = pointOnWall(wall, d.offset + d.width / 2);
        const behavior = doorBehavior(d);
        seen.add(d.id);
        const prev = this.doors.get(d.id);
        if (prev) {
          prev.behavior = behavior;
          prev.x = c.x;
          prev.z = c.y;
          prev.y = floor.elevation;
          prev.width = d.width;
          prev.floorId = floor.id;
          if (behavior === 'open') prev.target = 1;
          if (behavior === 'locked') prev.target = 0;
        } else {
          const open = behavior === 'open';
          this.doors.set(d.id, { id: d.id, floorId: floor.id, behavior, t: open ? 1 : 0, target: open ? 1 : 0, x: c.x, z: c.y, y: floor.elevation, width: d.width });
        }
      }
    }
    for (const id of Array.from(this.doors.keys())) if (!seen.has(id)) this.doors.delete(id);
  }

  setAutoDoors(flag: boolean): void {
    this.autoAll = flag;
  }

  get(id: string): DoorRuntime | undefined {
    return this.doors.get(id);
  }

  all(): DoorRuntime[] {
    return Array.from(this.doors.values());
  }

  behaviorOf(id: string): DoorBehavior | null {
    return this.doors.get(id)?.behavior ?? null;
  }

  private isAutomatic(d: DoorRuntime): boolean {
    return d.behavior === 'automatic' || (this.autoAll && d.behavior === 'manual');
  }

  /**
   * Advances every swing and runs the proximity logic for automatic doors.
   * Returns true when any leaf moved, so the renderer can skip idle frames.
   */
  update(dt: number, player: { x: number; y: number; z: number } | null): boolean {
    let moved = false;
    for (const d of this.doors.values()) {
      if (d.behavior === 'open') d.target = 1;
      else if (d.behavior === 'locked') d.target = 0;
      else if (player && this.isAutomatic(d) && Math.abs(player.y - d.y) < 1.8) {
        const dist = Math.hypot(player.x - d.x, player.z - d.z);
        if (dist < AUTO_OPEN_RADIUS) d.target = 1;
        else if (dist > AUTO_CLOSE_RADIUS) d.target = 0;
      }
      if (d.t !== d.target) {
        const step = dt / DOOR_SWING_SECONDS;
        d.t = d.target > d.t ? Math.min(1, d.t + step) : Math.max(0, d.t - step);
        moved = true;
      }
    }
    return moved;
  }

  /** E on a door. Returns what happened, for the prompt and the notice. */
  toggle(id: string): 'opened' | 'closed' | 'locked' | 'missing' {
    const d = this.doors.get(id);
    if (!d) return 'missing';
    if (d.behavior === 'locked') return 'locked';
    if (d.behavior === 'open') return 'opened';
    d.target = d.target === 1 ? 0 : 1;
    return d.target === 1 ? 'opened' : 'closed';
  }

  isOpen(id: string): boolean {
    return (this.doors.get(id)?.target ?? 0) === 1;
  }

  /** Eased opening fraction 0..1 for drawing. */
  openFraction(id: string): number {
    const d = this.doors.get(id);
    return d ? ease(d.t) : 0;
  }

  /** Current leaf angle in radians. */
  angleOf(id: string): number {
    return this.openFraction(id) * DOOR_OPEN_ANGLE;
  }

  /**
   * A door blocks until it has swung most of the way. A doorway that is
   * `open` never blocks, and the leaf of an open door is thin enough to walk
   * past, so it is not modelled as a solid.
   */
  isBlocking(id: string): boolean {
    const d = this.doors.get(id);
    if (!d) return false;
    if (d.behavior === 'open') return false;
    return d.t < 0.55;
  }

  promptFor(id: string): string | null {
    const d = this.doors.get(id);
    if (!d) return null;
    if (d.behavior === 'locked') return 'Locked';
    if (d.behavior === 'open') return null;
    return d.target === 1 ? 'Close door' : 'Open door';
  }

  /** Forget runtime state (used when leaving the walkthrough). */
  reset(): void {
    for (const d of this.doors.values()) {
      const open = d.behavior === 'open';
      d.t = open ? 1 : 0;
      d.target = open ? 1 : 0;
    }
  }
}
