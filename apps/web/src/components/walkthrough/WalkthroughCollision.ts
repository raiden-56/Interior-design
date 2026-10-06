/**
 * The collision world, derived from the canonical project.
 *
 * Nothing here is authored by hand: every wall, door leaf, piece of furniture,
 * floor slab and staircase in the model becomes a collider or a walkable
 * surface, and the world is rebuilt whenever `collisionSignature` changes. So
 * a wall moved in the editor is solid in the walkthrough on the next frame.
 *
 * Shapes are deliberately simple — boxes in plan view with a height range,
 * polygons for floors, ramps for stairs — because the render meshes are far
 * more detailed than a body needs, and testing against them would cost the
 * frame budget this mode depends on.
 */

import type { Floor, Project, Room, Vec2, Wall } from '@interior/core';
import { pointInPolygon, pointOnWall, wallLength, isMounted, bbox } from '@interior/core';
import { stairwellHolesAt } from '@/lib/three/scene';
import { circleVsOBB, obbFromObject, obbFromSegment, obbRadius, pointInOBB, toLocal, toWorld, type OBB } from './PlayerCollider';
import { rampFromObject, rampHeightAt, rampProgress, type StairRamp } from './StairController';
import { collisionEnabled } from './FurnitureInteraction';
import type { BodyDims } from './WalkSettings';

export type ColliderKind = 'wall' | 'door' | 'object';

export interface Collider {
  /** Entity id for walls and objects; door id for leaves; `elev:<objectId>` for lift doors. */
  id: string;
  kind: ColliderKind;
  floorId: string;
  obb: OBB;
  /** Absolute height range the solid occupies. */
  yMin: number;
  yMax: number;
  /** Broad-phase radius. */
  r: number;
}

export type Surface =
  | { kind: 'slab'; floorId: string; y: number; polygon: Vec2[]; holes: Vec2[][]; min: Vec2; max: Vec2 }
  | { kind: 'ramp'; floorId: string; y: number; ramp: StairRamp }
  | { kind: 'ground'; floorId: string; y: number };

export interface FloorInfo {
  id: string;
  name: string;
  elevation: number;
  height: number;
  index: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface CollisionWorld {
  colliders: Collider[];
  surfaces: Surface[];
  ramps: StairRamp[];
  floors: FloorInfo[];
  roomsByFloor: Map<string, Room[]>;
  bounds: Bounds;
  /** How far outside the drawn footprint the player may wander. */
  margin: number;
}

export interface GroundHit {
  y: number;
  floorId: string;
  kind: Surface['kind'];
  ramp?: StairRamp;
  /** 0..1 along the flight when on a ramp. */
  progress?: number;
}

/** Answers "does this door currently block?" and "which object am I sitting in?". */
export interface BlockQuery {
  doorBlocks: (doorId: string) => boolean;
  ignoreObjectId?: string | null;
}

export const PASS_ALL: BlockQuery = { doorBlocks: () => false };
export const BLOCK_ALL_DOORS: BlockQuery = { doorBlocks: () => true };

const WANDER_MARGIN = 2.5;

export function buildCollisionWorld(project: Project): CollisionWorld {
  const colliders: Collider[] = [];
  const surfaces: Surface[] = [];
  const ramps: StairRamp[] = [];
  const roomsByFloor = new Map<string, Room[]>();
  const visible = project.floors.filter((f) => f.visible);
  const floors: FloorInfo[] = visible.map((f, index) => ({ id: f.id, name: f.name, elevation: f.elevation, height: f.height, index }));

  const pts: Vec2[] = [];
  let maxY = 3;

  for (const floor of visible) {
    roomsByFloor.set(floor.id, floor.rooms);
    const e = floor.elevation;
    maxY = Math.max(maxY, e + Math.max(floor.height, ...floor.walls.map((w) => w.height)));

    for (const wall of floor.walls) {
      pts.push(wall.a, wall.b);
      for (const c of wallColliders(floor, wall)) colliders.push(c);
    }

    for (const room of floor.rooms) {
      if (room.points.length < 3) continue;
      pts.push(...room.points);
      const bb = bbox(room.points);
      surfaces.push({ kind: 'slab', floorId: floor.id, y: e, polygon: room.points, holes: stairwellHolesAt(project, e, floor.id), min: bb.min, max: bb.max });
    }
    // A floor with walls but no room polygons still needs something to stand
    // on above the ground floor; the editor's 3D view draws nothing there, so
    // use the footprint of the walls.
    if (floor.rooms.length === 0 && floor.walls.length > 0 && Math.abs(e) > 0.01) {
      const bb = bbox(floor.walls.flatMap((w) => [w.a, w.b]));
      const poly = [
        { x: bb.min.x, y: bb.min.y },
        { x: bb.max.x, y: bb.min.y },
        { x: bb.max.x, y: bb.max.y },
        { x: bb.min.x, y: bb.max.y },
      ];
      surfaces.push({ kind: 'slab', floorId: floor.id, y: e, polygon: poly, holes: stairwellHolesAt(project, e, floor.id), min: bb.min, max: bb.max });
    }

    for (const o of floor.objects) {
      pts.push({ x: o.x, y: o.z });
      const ramp = rampFromObject(o, floor, visible);
      if (ramp) {
        ramps.push(ramp);
        surfaces.push({ kind: 'ramp', floorId: floor.id, y: e, ramp });
        continue;
      }
      if (o.shape === 'elevator') {
        for (const c of elevatorColliders(floor, o)) colliders.push(c);
        continue;
      }
      if (!collisionEnabled(o) || isMounted(o)) continue;
      const obb = obbFromObject(o);
      colliders.push({ id: o.id, kind: 'object', floorId: floor.id, obb, yMin: e, yMax: e + o.height * o.scale, r: obbRadius(obb) });
    }
  }

  // The ground plane exists everywhere in the 3D scene, so it does here too;
  // it belongs to whichever floor sits at (or nearest) zero.
  const groundFloor = floors.slice().sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation))[0];
  if (groundFloor) surfaces.push({ kind: 'ground', floorId: groundFloor.id, y: 0 });

  const bb = pts.length ? bbox(pts) : { min: { x: -2, y: -2 }, max: { x: 6, y: 6 } };
  return {
    colliders,
    surfaces,
    ramps,
    floors,
    roomsByFloor,
    bounds: { minX: bb.min.x, maxX: bb.max.x, minZ: bb.min.y, maxZ: bb.max.y, minY: Math.min(0, ...floors.map((f) => f.elevation)), maxY },
    margin: WANDER_MARGIN,
  };
}

/** Wall solids with the door spans cut out, plus one collider per door leaf. */
function wallColliders(floor: Floor, wall: Wall): Collider[] {
  const out: Collider[] = [];
  const L = wallLength(wall);
  if (L < 1e-4) return out;
  const e = floor.elevation;
  const top = e + wall.height;
  const doors = floor.doors
    .filter((d) => d.wallId === wall.id)
    .map((d) => ({ id: d.id, offset: Math.min(Math.max(d.offset, 0), Math.max(L - d.width, 0)), width: d.width, height: d.height }))
    .sort((a, b) => a.offset - b.offset);

  const solid = (from: number, to: number) => {
    if (to - from < 1e-3) return;
    const obb = obbFromSegment(pointOnWall(wall, from), pointOnWall(wall, to), wall.thickness);
    out.push({ id: wall.id, kind: 'wall', floorId: floor.id, obb, yMin: e, yMax: top, r: obbRadius(obb) });
  };

  let cursor = 0;
  for (const d of doors) {
    solid(cursor, d.offset);
    const obb = obbFromSegment(pointOnWall(wall, d.offset), pointOnWall(wall, d.offset + d.width), wall.thickness);
    out.push({ id: d.id, kind: 'door', floorId: floor.id, obb, yMin: e, yMax: e + d.height, r: obbRadius(obb) });
    // The header over a low doorway is a real obstacle for a tall capsule.
    if (d.height < top - e - 0.05) {
      out.push({ id: wall.id, kind: 'wall', floorId: floor.id, obb, yMin: e + d.height, yMax: top, r: obbRadius(obb) });
    }
    cursor = d.offset + d.width;
  }
  solid(cursor, L);
  return out;
}

/** A lift car: three thin walls and a door collider across the open front. */
function elevatorColliders(floor: Floor, o: import('@interior/core').ProjectObject): Collider[] {
  const e = floor.elevation;
  const h = o.height * o.scale;
  const base = obbFromObject(o);
  const w = base.hw * 2;
  const d = base.hd * 2;
  const t = 0.06;
  const mk = (lx: number, lz: number, hw: number, hd: number, kind: ColliderKind, id: string): Collider => {
    const c = toWorld(base, lx, lz);
    const obb: OBB = { cx: c.x, cz: c.z, hw, hd, cos: base.cos, sin: base.sin };
    return { id, kind, floorId: floor.id, obb, yMin: e, yMax: e + h, r: obbRadius(obb) };
  };
  return [
    mk(0, -d / 2 + t / 2, w / 2, t / 2, 'object', o.id),
    mk(-w / 2 + t / 2, 0, t / 2, d / 2, 'object', o.id),
    mk(w / 2 - t / 2, 0, t / 2, d / 2, 'object', o.id),
    mk(0, d / 2 - 0.02, w / 2, 0.03, 'door', `elev:${o.id}`),
  ];
}

/**
 * Everything the walkthrough's physical world depends on. Compared to
 * `structureSignature` it also tracks object transforms, door behaviour and
 * floor visibility; it ignores colours and materials entirely.
 */
export function collisionSignature(project: Project): string {
  const parts: string[] = [];
  for (const f of project.floors) {
    parts.push(`f:${f.id}:${f.visible ? 1 : 0}:${f.elevation}:${f.height}:${f.name}`);
    if (!f.visible) continue;
    for (const w of f.walls) parts.push(`w:${w.id}:${w.a.x},${w.a.y},${w.b.x},${w.b.y},${w.height},${w.thickness}`);
    for (const d of f.doors) parts.push(`d:${d.id}:${d.wallId},${d.offset},${d.width},${d.height},${d.swing},${JSON.stringify(d.metadata ?? null)}`);
    for (const r of f.rooms) parts.push(`r:${r.id}:${r.name}:${r.points.map((p) => p.x + ',' + p.y).join(';')}`);
    for (const o of f.objects) {
      parts.push(`o:${o.id}:${o.shape},${o.name},${o.x},${o.z},${o.rotation},${o.scale},${o.width},${o.depth},${o.height},${JSON.stringify(o.metadata ?? null)}`);
    }
  }
  const wt = project.walkthrough;
  if (wt) parts.push(`wt:${wt.startSpawnId}:${wt.spawns.map((s) => `${s.id},${s.floorId},${s.x},${s.z},${s.yaw}`).join(';')}`);
  return parts.join('|');
}

function inSlab(s: Extract<Surface, { kind: 'slab' }>, x: number, z: number): boolean {
  if (x < s.min.x - 1e-6 || x > s.max.x + 1e-6 || z < s.min.y - 1e-6 || z > s.max.y + 1e-6) return false;
  const p = { x, y: z };
  if (!pointInPolygon(p, s.polygon)) return false;
  for (const hole of s.holes) if (pointInPolygon(p, hole)) return false;
  return true;
}

/**
 * The surface under (x, z) that the feet can stand on: the highest one no
 * more than `stepUp` above `feetY`. Returns null over a void — which, since the
 * ground plane is everywhere, only happens when the feet are already below it.
 */
export function groundAt(world: CollisionWorld, x: number, z: number, feetY: number, stepUp: number): GroundHit | null {
  const limit = feetY + stepUp;
  let best: GroundHit | null = null;
  for (const s of world.surfaces) {
    let y: number;
    let hit: GroundHit;
    if (s.kind === 'ground') {
      y = s.y;
      hit = { y, floorId: s.floorId, kind: 'ground' };
    } else if (s.kind === 'slab') {
      if (!inSlab(s, x, z)) continue;
      y = s.y;
      hit = { y, floorId: s.floorId, kind: 'slab' };
    } else {
      const ry = rampHeightAt(s.ramp, x, z);
      if (ry === null) continue;
      y = ry;
      const progress = rampProgress(s.ramp, x, z);
      hit = { y, floorId: progress > 0.5 && s.ramp.toFloorId ? s.ramp.toFloorId : s.floorId, kind: 'ramp', ramp: s.ramp, progress };
    }
    if (y > limit + 1e-6) continue;
    if (!best || y > best.y + 1e-6) best = hit;
  }
  return best;
}

/** True when any walkable surface of this floor is under (x, z) at that floor's level. */
export function onFloorSurface(world: CollisionWorld, floorId: string, x: number, z: number): boolean {
  const info = world.floors.find((f) => f.id === floorId);
  if (!info) return false;
  const hit = groundAt(world, x, z, info.elevation + 0.05, 0.3);
  return !!hit && Math.abs(hit.y - info.elevation) < 0.35;
}

export interface Resolved {
  x: number;
  z: number;
  /** Total displacement applied, metres. 0 means the spot was free. */
  pushed: number;
  /** Ids of colliders that were touched. */
  touched: string[];
}

/**
 * Pushes a circle at (x, z) out of every solid it overlaps. Solids below the
 * step height are walked over (a rug, a low plinth) and solids that start above
 * the head are ignored (a pendant, a wall-mounted TV).
 */
export function resolveHorizontal(
  world: CollisionWorld,
  x: number,
  z: number,
  body: BodyDims,
  feetY: number,
  q: BlockQuery = BLOCK_ALL_DOORS,
  iterations = 4,
): Resolved {
  const lo = feetY + body.stepUp;
  const hi = feetY + body.height;
  const r = body.radius;
  let px = x;
  let pz = z;
  let pushed = 0;
  const touched: string[] = [];

  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (const c of world.colliders) {
      if (c.yMax <= lo + 1e-3 || c.yMin >= hi - 1e-3) continue;
      if (c.kind === 'door' && !q.doorBlocks(c.id)) continue;
      if (c.kind === 'object' && q.ignoreObjectId && c.id === q.ignoreObjectId) continue;
      const dx = px - c.obb.cx;
      const dz = pz - c.obb.cz;
      const reach = c.r + r;
      if (dx * dx + dz * dz > reach * reach) continue;
      const pen = circleVsOBB(c.obb, px, pz, r);
      if (!pen) continue;
      px += pen.nx * pen.depth;
      pz += pen.nz * pen.depth;
      pushed += pen.depth;
      moved = true;
      if (!touched.includes(c.id)) touched.push(c.id);
    }
    // A staircase is walkable from its ends but solid from the sides and
    // underneath: where the flight stands higher than a step above the feet,
    // its footprint behaves like a box.
    for (const ramp of world.ramps) {
      const dx = px - ramp.obb.cx;
      const dz = pz - ramp.obb.cz;
      const reach = obbRadius(ramp.obb) + r;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (ramp.base >= hi || ramp.base + ramp.rise <= lo) continue;
      const pen = circleVsOBB(ramp.obb, px, pz, r);
      if (!pen) continue;
      const local = toLocal(ramp.obb, px, pz);
      const inside = toWorld(ramp.obb, Math.min(Math.max(local.x, -ramp.obb.hw), ramp.obb.hw), Math.min(Math.max(local.z, -ramp.obb.hd), ramp.obb.hd));
      const flightY = rampHeightAt(ramp, inside.x, inside.z, 1e-3) ?? ramp.base;
      if (flightY - feetY <= body.stepUp + 0.03) continue; // low enough to step onto
      px += pen.nx * pen.depth;
      pz += pen.nz * pen.depth;
      pushed += pen.depth;
      moved = true;
      if (!touched.includes(ramp.objectId)) touched.push(ramp.objectId);
    }
    if (!moved) break;
  }

  // Invisible fence around the drawing so nobody wanders off into the void.
  const b = world.bounds;
  const m = world.margin;
  const cx = Math.min(Math.max(px, b.minX - m), b.maxX + m);
  const cz = Math.min(Math.max(pz, b.minZ - m), b.maxZ + m);
  pushed += Math.abs(cx - px) + Math.abs(cz - pz);
  return { x: cx, z: cz, pushed, touched };
}

/**
 * True when the straight line between two points at a given floor level
 * crosses a wall or a blocking door. Used to reject "safe" spots that are
 * only safe because they are on the other side of a wall.
 */
export function pathBlocked(world: CollisionWorld, ax: number, az: number, bx: number, bz: number, feetY: number, q: BlockQuery = BLOCK_ALL_DOORS): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(d / 0.08));
  const lo = feetY + 0.2;
  const hi = feetY + 1.5;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    for (const c of world.colliders) {
      if (c.kind === 'object') continue;
      if (c.yMax <= lo || c.yMin >= hi) continue;
      if (c.kind === 'door' && !q.doorBlocks(c.id)) continue;
      if (pointInOBB(c.obb, x, z, 0.02)) return true;
    }
  }
  return false;
}

/** Can a body stand here without being pushed and with a floor under it near `y`? */
export function isStandable(world: CollisionWorld, x: number, z: number, y: number, body: BodyDims, q: BlockQuery = BLOCK_ALL_DOORS, tolerance = 0.02): boolean {
  const g = groundAt(world, x, z, y + 0.05, body.stepUp);
  if (!g || y - g.y > 0.6) return false;
  const res = resolveHorizontal(world, x, z, body, g.y, q, 2);
  return res.pushed <= tolerance;
}

export function floorInfo(world: CollisionWorld, floorId: string | null | undefined): FloorInfo | null {
  return world.floors.find((f) => f.id === floorId) ?? null;
}

/** The floor whose level is nearest to, and not above, a height. */
export function floorAtHeight(world: CollisionWorld, y: number): FloorInfo | null {
  let best: FloorInfo | null = null;
  for (const f of world.floors) {
    if (f.elevation <= y + 0.4 && (!best || f.elevation > best.elevation)) best = f;
  }
  return best ?? world.floors[0] ?? null;
}

/** The room on `floorId` containing the point, if any. */
export function roomAt(world: CollisionWorld, floorId: string | null, x: number, z: number): Room | null {
  if (!floorId) return null;
  const rooms = world.roomsByFloor.get(floorId) ?? [];
  const p = { x, y: z };
  // Smallest containing room wins, so a nook drawn inside a hall is reported.
  let best: Room | null = null;
  let bestArea = Infinity;
  for (const r of rooms) {
    if (r.points.length < 3 || !pointInPolygon(p, r.points)) continue;
    const bb = bbox(r.points);
    const area = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y);
    if (area < bestArea) {
      best = r;
      bestArea = area;
    }
  }
  return best;
}

/** Whether the point is inside any object footprint on the floor (used for spawn search). */
export function insideAnyObject(world: CollisionWorld, floorId: string, x: number, z: number): boolean {
  return world.colliders.some((c) => c.kind === 'object' && c.floorId === floorId && pointInOBB(c.obb, x, z));
}
