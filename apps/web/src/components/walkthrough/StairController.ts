/**
 * Stairs as walkable geometry.
 *
 * A staircase in the model is an ordinary catalog object (`shape: 'stairs'`)
 * whose height is its total rise. For the feet it is treated as a smooth ramp
 * from its front edge to its back edge: following the actual treads would
 * make the camera hop on every riser, and a ramp whose slope matches the
 * flight exactly puts the eye where it would be on the real stairs within a
 * few centimetres. Nothing is teleported — the player climbs because the
 * ground under them rises.
 */

import type { Floor, ProjectObject } from '@interior/core';
import { obbFromObject, toLocal, toWorld, type OBB } from './PlayerCollider';

export interface StairRamp {
  objectId: string;
  /** Floor the flight starts on. */
  floorId: string;
  /** Floor it arrives at, when one sits at the top; null for stairs to nowhere. */
  toFloorId: string | null;
  /** Absolute height of the bottom step's floor. */
  base: number;
  rise: number;
  /** Footprint; local +z is the bottom of the flight, -z the top. */
  obb: OBB;
  depth: number;
  width: number;
}

export function isStairs(o: ProjectObject): boolean {
  return o.shape === 'stairs';
}

/** The ramp for a stairs object, or null for anything else. */
export function rampFromObject(o: ProjectObject, floor: Floor, floors: Floor[]): StairRamp | null {
  if (!isStairs(o)) return null;
  const rise = o.height * o.scale;
  const top = floor.elevation + rise;
  let toFloorId: string | null = null;
  let best = 0.35;
  for (const f of floors) {
    if (f.id === floor.id) continue;
    const d = Math.abs(f.elevation - top);
    if (d < best) {
      best = d;
      toFloorId = f.id;
    }
  }
  return {
    objectId: o.id,
    floorId: floor.id,
    toFloorId,
    base: floor.elevation,
    rise,
    obb: obbFromObject(o),
    depth: o.depth * o.scale,
    width: o.width * o.scale,
  };
}

/** 0 at the bottom edge, 1 at the top edge; clamped. */
export function rampProgress(r: StairRamp, x: number, z: number): number {
  const p = toLocal(r.obb, x, z);
  const t = (r.obb.hd - p.z) / (2 * r.obb.hd);
  return Math.min(Math.max(t, 0), 1);
}

/** Absolute ground height on the ramp at (x, z), or null when off the footprint. */
export function rampHeightAt(r: StairRamp, x: number, z: number, pad = 0): number | null {
  const p = toLocal(r.obb, x, z);
  if (Math.abs(p.x) > r.obb.hw + pad || Math.abs(p.z) > r.obb.hd + pad) return null;
  return r.base + r.rise * rampProgress(r, x, z);
}

/** World point just beyond the bottom step — where you stand to start climbing. */
export function rampBottomPoint(r: StairRamp, clearance = 0.5): { x: number; z: number } {
  return toWorld(r.obb, 0, r.obb.hd + clearance);
}

/** World point just past the top step. */
export function rampTopPoint(r: StairRamp, clearance = 0.5): { x: number; z: number } {
  return toWorld(r.obb, 0, -r.obb.hd - clearance);
}

/** Heading (camera yaw) that looks up the flight. */
export function rampUpYaw(r: StairRamp): number {
  // Local -z direction in world space.
  const dx = r.obb.sin;
  const dz = -r.obb.cos;
  return Math.atan2(-dx, -dz);
}
