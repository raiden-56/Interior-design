/**
 * Route finding for "take me to the kitchen".
 *
 * The collision world is sampled onto a coarse grid; every cell keeps one node
 * per walkable surface under it (a hallway on the ground floor and the landing
 * above it are two nodes in the same cell). Neighbours are adjacent cells
 * whose node heights differ by no more than a step — which is exactly how a
 * staircase, being a ramp, links two floors without any special casing. A*
 * then runs over that graph.
 */

import type { Project, Room } from '@interior/core';
import { polygonArea, polygonCentroid } from '@interior/core';
import { groundAt, resolveHorizontal, type BlockQuery, type CollisionWorld } from './WalkthroughCollision';
import type { BodyDims } from './WalkSettings';
import { interactionOf } from './FurnitureInteraction';
import { rampBottomPoint, rampTopPoint } from './StairController';

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

export interface Route {
  points: NavPoint[];
  length: number;
  /** Floors visited, in order. */
  floorIds: string[];
}

export interface Destination {
  id: string;
  label: string;
  floorId: string;
  floorName: string;
  kind: 'room' | 'object' | 'spawn' | 'stairs' | 'elevator';
  x: number;
  y: number;
  z: number;
}

interface Node {
  ix: number;
  iz: number;
  y: number;
  floorId: string;
  walkable: boolean;
}

const NAV_STEP = 0.45;

export class NavGrid {
  readonly cell: number;
  readonly ox: number;
  readonly oz: number;
  readonly nx: number;
  readonly nz: number;
  /** cells[ix + iz * nx] → nodes at that cell, sorted by y. */
  private cells: Node[][];

  readonly world: CollisionWorld;

  constructor(world: CollisionWorld, body: BodyDims, q: BlockQuery, cell = 0.3) {
    this.world = world;
    this.cell = cell;
    const b = world.bounds;
    const m = 1;
    this.ox = b.minX - m;
    this.oz = b.minZ - m;
    this.nx = Math.max(1, Math.ceil((b.maxX - b.minX + 2 * m) / cell));
    this.nz = Math.max(1, Math.ceil((b.maxZ - b.minZ + 2 * m) / cell));
    this.cells = new Array(this.nx * this.nz);
    const slim: BodyDims = { ...body, radius: Math.max(0.12, body.radius * 0.7) };

    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.ox + (ix + 0.5) * cell;
        const z = this.oz + (iz + 0.5) * cell;
        const ys = surfaceHeightsAt(world, x, z);
        const nodes: Node[] = [];
        for (const { y, floorId } of ys) {
          const res = resolveHorizontal(world, x, z, slim, y, q, 1);
          nodes.push({ ix, iz, y, floorId, walkable: res.pushed < 0.005 });
        }
        this.cells[ix + iz * this.nx] = nodes;
      }
    }
  }

  nodesAt(ix: number, iz: number): Node[] {
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return [];
    return this.cells[ix + iz * this.nx] ?? [];
  }

  cellOf(x: number, z: number): { ix: number; iz: number } {
    return { ix: Math.floor((x - this.ox) / this.cell), iz: Math.floor((z - this.oz) / this.cell) };
  }

  centre(ix: number, iz: number): { x: number; z: number } {
    return { x: this.ox + (ix + 0.5) * this.cell, z: this.oz + (iz + 0.5) * this.cell };
  }

  /** Nearest walkable node to a world point at roughly height y (searches outward up to `radius` cells). */
  nearest(x: number, y: number, z: number, radius = 6): Node | null {
    const c = this.cellOf(x, z);
    let best: Node | null = null;
    let bestD = Infinity;
    for (let r = 0; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (const n of this.nodesAt(c.ix + dx, c.iz + dz)) {
            if (!n.walkable || Math.abs(n.y - y) > 1.2) continue;
            const p = this.centre(n.ix, n.iz);
            const d = Math.hypot(p.x - x, p.z - z) + Math.abs(n.y - y) * 2;
            if (d < bestD) {
              best = n;
              bestD = d;
            }
          }
        }
      }
      if (best) return best;
    }
    return best;
  }

  private key(n: Node): string {
    return `${n.ix},${n.iz},${n.y.toFixed(2)}`;
  }

  private neighbours(n: Node): { node: Node; cost: number }[] {
    const out: { node: Node; cost: number }[] = [];
    // Of the surfaces stacked under a neighbouring cell, take the highest one
    // within a step. A staircase sits on the slab below it, so "nearest in
    // height" would keep choosing the floor under the flight and never climb.
    const pick = (ix: number, iz: number): Node | null => {
      let best: Node | null = null;
      for (const m of this.nodesAt(ix, iz)) {
        if (!m.walkable || Math.abs(m.y - n.y) > NAV_STEP) continue;
        if (!best || m.y > best.y) best = m;
      }
      return best;
    };
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const m = pick(n.ix + dx, n.iz + dz);
        if (!m) continue;
        // No corner cutting: a diagonal needs both orthogonal cells free.
        if (dx && dz && (!pick(n.ix + dx, n.iz) || !pick(n.ix, n.iz + dz))) continue;
        const horiz = this.cell * (dx && dz ? Math.SQRT2 : 1);
        out.push({ node: m, cost: Math.hypot(horiz, m.y - n.y) });
      }
    }
    return out;
  }

  findPath(from: NavPoint, to: NavPoint): Route | null {
    const start = this.nearest(from.x, from.y, from.z);
    const goal = this.nearest(to.x, to.y, to.z);
    if (!start || !goal) return null;

    const h = (n: Node) => {
      const a = this.centre(n.ix, n.iz);
      const b = this.centre(goal.ix, goal.iz);
      return Math.hypot(a.x - b.x, a.z - b.z, n.y - goal.y);
    };
    const open = new MinHeap<{ node: Node; f: number }>((a, b) => a.f - b.f);
    const g = new Map<string, number>();
    const came = new Map<string, Node>();
    const closed = new Set<string>();
    const sk = this.key(start);
    g.set(sk, 0);
    open.push({ node: start, f: h(start) });
    const goalKey = this.key(goal);
    let expanded = 0;

    while (open.size) {
      const { node } = open.pop()!;
      const k = this.key(node);
      if (closed.has(k)) continue;
      closed.add(k);
      if (k === goalKey) return this.reconstruct(came, node, from, to);
      if (++expanded > 60000) break;
      const gn = g.get(k) ?? Infinity;
      for (const { node: m, cost } of this.neighbours(node)) {
        const mk = this.key(m);
        if (closed.has(mk)) continue;
        const tentative = gn + cost;
        if (tentative < (g.get(mk) ?? Infinity)) {
          g.set(mk, tentative);
          came.set(mk, node);
          open.push({ node: m, f: tentative + h(m) });
        }
      }
    }
    return null;
  }

  private reconstruct(came: Map<string, Node>, end: Node, from: NavPoint, to: NavPoint): Route {
    const nodes: Node[] = [end];
    let cur = end;
    while (came.has(this.key(cur))) {
      cur = came.get(this.key(cur))!;
      nodes.push(cur);
    }
    nodes.reverse();
    const pts: NavPoint[] = nodes.map((n) => ({ ...this.centre(n.ix, n.iz), y: n.y }));
    const simplified = this.simplify(pts);
    // Start exactly where the player is and end at the requested point.
    simplified[0] = { x: from.x, y: from.y, z: from.z };
    simplified.push({ x: to.x, y: Math.max(to.y, nodes[nodes.length - 1].y), z: to.z });
    let length = 0;
    for (let i = 1; i < simplified.length; i++) {
      length += Math.hypot(simplified[i].x - simplified[i - 1].x, simplified[i].z - simplified[i - 1].z);
    }
    const floorIds: string[] = [];
    for (const n of nodes) if (floorIds[floorIds.length - 1] !== n.floorId) floorIds.push(n.floorId);
    return { points: simplified, length, floorIds };
  }

  /** Greedy string pulling: skip waypoints while the straight line stays on walkable nodes. */
  private simplify(pts: NavPoint[]): NavPoint[] {
    if (pts.length <= 2) return pts.slice();
    const out: NavPoint[] = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineClear(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  private lineClear(a: NavPoint, b: NavPoint): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.ceil(dist / (this.cell * 0.5)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const y = a.y + (b.y - a.y) * t;
      const c = this.cellOf(x, z);
      const ok = this.nodesAt(c.ix, c.iz).some((n) => n.walkable && Math.abs(n.y - y) <= NAV_STEP);
      if (!ok) return false;
    }
    return true;
  }
}

/** Every walkable height under a point, with the floor it belongs to. */
function surfaceHeightsAt(world: CollisionWorld, x: number, z: number): { y: number; floorId: string }[] {
  const out: { y: number; floorId: string }[] = [];
  // Probe from the top down: ask for the highest surface below each level.
  let probe = world.bounds.maxY + 5;
  for (let guard = 0; guard < 12; guard++) {
    const g = groundAt(world, x, z, probe - 0.3, 0.3);
    if (!g) break;
    if (!out.some((o) => Math.abs(o.y - g.y) < 0.08)) out.push({ y: g.y, floorId: g.floorId });
    probe = g.y - 0.05;
    if (probe < world.bounds.minY - 1) break;
  }
  return out.sort((a, b) => a.y - b.y);
}

class MinHeap<T> {
  private a: T[] = [];
  private cmp: (a: T, b: T) => number;
  constructor(cmp: (a: T, b: T) => number) {
    this.cmp = cmp;
  }
  get size(): number {
    return this.a.length;
  }
  push(v: T): void {
    this.a.push(v);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cmp(this.a[i], this.a[p]) >= 0) break;
      [this.a[i], this.a[p]] = [this.a[p], this.a[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    if (!this.a.length) return undefined;
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.a.length && this.cmp(this.a[l], this.a[m]) < 0) m = l;
        if (r < this.a.length && this.cmp(this.a[r], this.a[m]) < 0) m = r;
        if (m === i) break;
        [this.a[i], this.a[m]] = [this.a[m], this.a[i]];
        i = m;
      }
    }
    return top;
  }
}

/** Places a person can ask to be guided to. */
export function destinationsFor(project: Project, world: CollisionWorld): Destination[] {
  const out: Destination[] = [];
  const floorName = (id: string) => project.floors.find((f) => f.id === id)?.name ?? '';
  for (const floor of project.floors) {
    if (!floor.visible) continue;
    const rooms = floor.rooms.filter((r) => r.points.length >= 3).sort((a, b) => Math.abs(polygonArea(b.points)) - Math.abs(polygonArea(a.points)));
    rooms.forEach((r: Room, i) => {
      const c = polygonCentroid(r.points);
      out.push({ id: r.id, label: r.name || `Room ${String(i + 1).padStart(2, '0')}`, floorId: floor.id, floorName: floor.name, kind: 'room', x: c.x, y: floor.elevation, z: c.y });
    });
    for (const o of floor.objects) {
      const t = interactionOf(o).type;
      if (t === 'stairs') {
        const ramp = world.ramps.find((r) => r.objectId === o.id);
        const p = ramp ? rampBottomPoint(ramp) : { x: o.x, z: o.z };
        const to = ramp?.toFloorId ? ` → ${floorName(ramp.toFloorId)}` : '';
        out.push({ id: o.id, label: `${o.name}${to}`, floorId: floor.id, floorName: floor.name, kind: 'stairs', x: p.x, y: floor.elevation, z: p.z });
        if (ramp?.toFloorId) {
          const top = rampTopPoint(ramp);
          out.push({ id: o.id + ':top', label: `${o.name} (top)`, floorId: ramp.toFloorId, floorName: floorName(ramp.toFloorId), kind: 'stairs', x: top.x, y: floor.elevation + ramp.rise, z: top.z });
        }
        continue;
      }
      if (t === 'elevator') {
        out.push({ id: o.id, label: o.name, floorId: floor.id, floorName: floor.name, kind: 'elevator', x: o.x, y: floor.elevation, z: o.z });
        continue;
      }
      if (t === 'sit' || t === 'lie' || t === 'view' || o.shape === 'desk' || o.shape === 'dining-table' || o.shape === 'kitchen-island') {
        out.push({ id: o.id, label: o.name, floorId: floor.id, floorName: floor.name, kind: 'object', x: o.x, y: floor.elevation, z: o.z });
      }
    }
  }
  for (const s of project.walkthrough?.spawns ?? []) {
    const f = project.floors.find((fl) => fl.id === s.floorId);
    if (!f || !f.visible) continue;
    out.push({ id: s.id, label: s.name, floorId: f.id, floorName: f.name, kind: 'spawn', x: s.x, y: f.elevation, z: s.z });
  }
  return out;
}

/** Heights along a route, re-sampled on the ground so the drawn line hugs stairs. */
export function sampleRoute(world: CollisionWorld, route: Route, spacing = 0.35): NavPoint[] {
  const out: NavPoint[] = [];
  const pts = route.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / spacing));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const yGuess = a.y + (b.y - a.y) * t;
      const g = groundAt(world, x, z, yGuess + 0.3, 0.6);
      out.push({ x, y: g ? g.y : yGuess, z });
    }
  }
  const last = pts[pts.length - 1];
  if (last) out.push(last);
  return out;
}
