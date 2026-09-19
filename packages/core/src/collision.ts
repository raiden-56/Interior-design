import type { Floor, ProjectObject, Wall } from './types';
import type { Vec2 } from './types';
import { closestPointOnSegment, deg, dist, pointInPolygon, polygonArea } from './geometry';

export interface CollisionWarning {
  level: 'error' | 'warning';
  message: string;
  objectId?: string;
  wallId?: string;
}

/**
 * Collision engine. Non-blocking: surfaces warnings instead of preventing
 * design intent. Uses OBB-vs-segment approximations.
 */

/** Object footprint corners in world space (rotated around its center). */
export function objectCorners(o: ProjectObject): Vec2[] {
  const hw = (o.width * o.scale) / 2;
  const hd = (o.depth * o.scale) / 2;
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  const local = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
  return local.map((p) => ({
    x: o.x + p.x * cos - p.y * sin,
    y: o.z + p.x * sin + p.y * cos,
  }));
}

export function objectRadius(o: ProjectObject): number {
  return (Math.hypot(o.width * o.scale, o.depth * o.scale) * 0.5) / 1.414;
}

function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  const d2 = (p2.x - p1.x) * (p4.y - p1.y) - (p2.y - p1.y) * (p4.x - p1.x);
  const d3 = (p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x);
  const d4 = (p4.x - p3.x) * (p2.y - p3.y) - (p4.y - p3.y) * (p2.x - p3.x);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function wallIntersectsObject(w: Wall, o: ProjectObject): boolean {
  const corners = objectCorners(o);
  for (let i = 0; i < 4; i++) {
    if (segmentsIntersect(corners[i], corners[(i + 1) % 4], w.a, w.b)) return true;
  }
  return false;
}

function openingBlocked(w: Wall, o: ProjectObject, openingCurves: { a: Vec2; b: Vec2 }[], cushion = 0.2): boolean {
  for (const oc of openingCurves) {
    const d = dist(oc.a, oc.b);
    const mid = { x: (oc.a.x + oc.b.x) / 2, y: (oc.a.y + oc.b.y) / 2 };
    const r = d / 2 + cushion + objectRadius(o);
    if (dist(mid, { x: o.x, y: o.z }) <= r) return true;
  }
  return false;
}

/**
 * Wall- and ceiling-mounted pieces — TVs, split ACs, ceiling fans, mirrors,
 * geysers, chimney hoods. They are *meant* to touch a wall, they hang above
 * head height, and they never obstruct a doorway at floor level, so the floor
 * clearance rules below would report nothing but false alarms for them.
 */
export function isMounted(o: ProjectObject): boolean {
  return o.metadata?.mounted === true;
}

/** Rugs lie under the furniture; overlapping them is the point. */
const isFloorCovering = (o: ProjectObject): boolean => o.shape === 'rug';

/** Seating is meant to tuck under a table, so that pair never counts as a clash. */
const SEATING = new Set(['chair', 'stool', 'office-chair', 'bench']);
const TABLES = new Set(['dining-table', 'round-table', 'desk', 'kitchen-island', 'coffee-table']);
const tucksUnder = (a: ProjectObject, b: ProjectObject): boolean =>
  (SEATING.has(a.shape) && TABLES.has(b.shape)) || (SEATING.has(b.shape) && TABLES.has(a.shape));

/** Smallest gap between a wall segment and an object's footprint. */
function wallGap(w: Wall, o: ProjectObject): number {
  let best = Infinity;
  for (const c of objectCorners(o)) best = Math.min(best, closestPointOnSegment(c, w.a, w.b).d);
  return best;
}

/**
 * Separating-axis test on the two footprints.
 *
 * Overlap used to be measured between bounding circles, which flagged every
 * chair at a table and every nightstand beside a bed — so a freshly opened
 * template arrived with dozens of warnings and people learned to ignore the
 * panel. `tolerance` lets pieces touch without complaint.
 */
function footprintsOverlap(a: ProjectObject, b: ProjectObject, tolerance = 0.04): boolean {
  const ca = objectCorners(a);
  const cb = objectCorners(b);
  const axes: Vec2[] = [];
  for (const corners of [ca, cb]) {
    for (let i = 0; i < 2; i++) {
      const dx = corners[i + 1].x - corners[i].x;
      const dy = corners[i + 1].y - corners[i].y;
      const len = Math.hypot(dx, dy) || 1;
      axes.push({ x: -dy / len, y: dx / len });
    }
  }
  for (const ax of axes) {
    const pa = ca.map((p) => p.x * ax.x + p.y * ax.y);
    const pb = cb.map((p) => p.x * ax.x + p.y * ax.y);
    const depth = Math.min(Math.max(...pa) - Math.min(...pb), Math.max(...pb) - Math.min(...pa));
    if (depth <= tolerance) return false;
  }
  return true;
}

export function analyseFloor(floor: Floor): CollisionWarning[] {
  const warnings: CollisionWarning[] = [];

  const wallDists = floor.walls.map((w) => {
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    return { w, len };
  });

  // Object vs wall + object vs opening clearance
  for (const o of floor.objects) {
    if (isMounted(o)) continue;
    let minWallDist = Infinity;
    for (const { w } of wallDists) {
      // Measured from the footprint, not from a circle around it: a bed with
      // its headboard against the wall is flush, not "17 cm away".
      minWallDist = Math.min(minWallDist, wallGap(w, o));
      if (wallIntersectsObject(w, o)) {
        warnings.push({
          level: 'error',
          message: `"${o.name}" intersects a wall`,
          objectId: o.id,
          wallId: w.id,
        });
      }
    }
    // A gap too narrow to use but too wide to be flush is usually a slip —
    // but only for furniture you have to walk around. A plant or a lamp
    // standing 25 cm off the wall is how people actually place them.
    const footprint = o.width * o.scale * o.depth * o.scale;
    if (footprint >= 0.5 && minWallDist > 0.08 && minWallDist < 0.4) {
      warnings.push({
        level: 'warning',
        message: `"${o.name}" is too close to a wall (${(minWallDist * 100).toFixed(0)} cm clearance)`,
        objectId: o.id,
      });
    }

    // Blocking a door passage
    for (const d of floor.doors) {
      const w = floor.walls.find((ww) => ww.id === d.wallId);
      if (!w) continue;
      const dir = normalizedDir(w);
      const a = { x: w.a.x + dir.x * d.offset, y: w.a.y + dir.y * d.offset };
      const b = { x: a.x + dir.x * d.width, y: a.y + dir.y * d.width };
      if (openingBlocked(w, o, [{ a, b }])) {
        warnings.push({
          level: 'error',
          message: `"${o.name}" blocks a door opening`,
          objectId: o.id,
        });
      }
    }

    // Object-to-object overlap
    for (const other of floor.objects) {
      if (other.id === o.id || isMounted(other)) continue;
      if (isFloorCovering(o) || isFloorCovering(other) || tucksUnder(o, other)) continue;
      if (footprintsOverlap(o, other)) {
        warnings.push({
          level: 'warning',
          message: `"${o.name}" overlaps "${other.name}"`,
          objectId: o.id,
        });
      }
    }
  }

  // Room sanity: doors/windows must reference a real wall and sit inside it
  for (const d of floor.doors) {
    const w = floor.walls.find((ww) => ww.id === d.wallId);
    if (!w) {
      warnings.push({ level: 'error', message: 'Door has no wall', wallId: d.wallId });
    } else {
      const wallLen = wallDists.find((x) => x.w.id === w.id)?.len ?? 0;
      if (d.offset + d.width > wallLen + 1e-6) {
        warnings.push({ level: 'error', message: 'Door extends past its wall', wallId: w.id });
      }
    }
  }
  for (const win of floor.windows) {
    const w = floor.walls.find((ww) => ww.id === win.wallId);
    if (!w) {
      warnings.push({ level: 'error', message: 'Window has no wall', wallId: win.wallId });
    }
  }

  return warnings;
}

function normalizedDir(w: Wall): Vec2 {
  const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
  return { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
}

/** True when a point sits inside any closed room polygon. */
export function pointInAnyRoom(floor: Floor, p: Vec2): boolean {
  return floor.rooms.some((r) => r.points.length >= 3 && pointInPolygon(p, r.points));
}

export function roomArea(m2: number): string {
  return `${m2.toFixed(2)} m²`;
}

export function largestRoomArea(floor: Floor): number {
  let best = 0;
  for (const r of floor.rooms) {
    if (r.points.length >= 3) best = Math.max(best, Math.abs(polygonArea(r.points)));
  }
  return best;
}

/** NaN-guard for the rotation display. */
export function safeDeg(radians: number): number {
  const d = deg(radians);
  return Number.isFinite(d) ? Math.round(d) : 0;
}