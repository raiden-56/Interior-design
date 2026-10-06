/**
 * The player's body is a capsule; everything it can bump into is an oriented
 * box standing on the floor. Walls, furniture and door leaves are all vertical
 * extrusions of a plan-view rectangle, so the whole collision problem reduces
 * to a circle against rotated rectangles in 2D plus a height-range test —
 * dramatically cheaper than testing the capsule against every triangle, and
 * it never gets stuck on the seams between mesh faces.
 */

import type { ProjectObject, Vec2 } from '@interior/core';

/** Oriented bounding box in plan view: centre, half extents, rotation. */
export interface OBB {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  cos: number;
  sin: number;
}

export function obbFromObject(o: ProjectObject, inflate = 0): OBB {
  return {
    cx: o.x,
    cz: o.z,
    hw: (o.width * o.scale) / 2 + inflate,
    hd: (o.depth * o.scale) / 2 + inflate,
    cos: Math.cos(o.rotation),
    sin: Math.sin(o.rotation),
  };
}

/** Box around a wall segment (centreline a→b) of the given thickness. */
export function obbFromSegment(a: Vec2, b: Vec2, thickness: number): OBB {
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const len = Math.hypot(dx, dz) || 1e-6;
  return {
    cx: (a.x + b.x) / 2,
    cz: (a.y + b.y) / 2,
    hw: len / 2,
    hd: thickness / 2,
    cos: dx / len,
    sin: dz / len,
  };
}

/** World → box-local coordinates (x along the box's width, z along its depth). */
export function toLocal(b: OBB, x: number, z: number): { x: number; z: number } {
  const dx = x - b.cx;
  const dz = z - b.cz;
  return { x: dx * b.cos + dz * b.sin, z: -dx * b.sin + dz * b.cos };
}

export function toWorld(b: OBB, lx: number, lz: number): { x: number; z: number } {
  return { x: b.cx + lx * b.cos - lz * b.sin, z: b.cz + lx * b.sin + lz * b.cos };
}

export function pointInOBB(b: OBB, x: number, z: number, pad = 0): boolean {
  const p = toLocal(b, x, z);
  return Math.abs(p.x) <= b.hw + pad && Math.abs(p.z) <= b.hd + pad;
}

/** Corners in world space, counter-clockwise in plan. */
export function obbCorners(b: OBB): Vec2[] {
  return [
    toWorld(b, -b.hw, -b.hd),
    toWorld(b, b.hw, -b.hd),
    toWorld(b, b.hw, b.hd),
    toWorld(b, -b.hw, b.hd),
  ].map((p) => ({ x: p.x, y: p.z }));
}

/** Radius of the circle that encloses the box, for the broad phase. */
export const obbRadius = (b: OBB): number => Math.hypot(b.hw, b.hd);

export interface Penetration {
  /** How far the circle is inside the box. */
  depth: number;
  /** Unit push-out direction in world space. */
  nx: number;
  nz: number;
}

/**
 * Circle (x, z, r) against a box. Returns the shortest push that separates
 * them, or null when they do not touch. A centre that has ended up *inside*
 * the box (a fast step, or a box that moved onto the player) is pushed out of
 * the nearest face rather than left to jitter.
 */
export function circleVsOBB(b: OBB, x: number, z: number, r: number): Penetration | null {
  const p = toLocal(b, x, z);
  const qx = Math.min(Math.max(p.x, -b.hw), b.hw);
  const qz = Math.min(Math.max(p.z, -b.hd), b.hd);
  const dx = p.x - qx;
  const dz = p.z - qz;
  const dist2 = dx * dx + dz * dz;

  let lnx: number;
  let lnz: number;
  let depth: number;
  if (dist2 > 1e-10) {
    if (dist2 >= r * r) return null;
    const dist = Math.sqrt(dist2);
    lnx = dx / dist;
    lnz = dz / dist;
    depth = r - dist;
  } else {
    // Centre inside: leave through the face that is closest.
    const ox = b.hw - Math.abs(p.x);
    const oz = b.hd - Math.abs(p.z);
    if (ox < oz) {
      lnx = p.x >= 0 ? 1 : -1;
      lnz = 0;
      depth = ox + r;
    } else {
      lnx = 0;
      lnz = p.z >= 0 ? 1 : -1;
      depth = oz + r;
    }
  }
  return {
    depth,
    nx: lnx * b.cos - lnz * b.sin,
    nz: lnx * b.sin + lnz * b.cos,
  };
}

/** True when two height ranges overlap by more than a hair. */
export function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number, eps = 1e-3): boolean {
  return aMin < bMax - eps && bMin < aMax - eps;
}
