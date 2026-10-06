/**
 * Where a walkthrough begins.
 *
 * A designer can mark start points in the editor (they live on the project);
 * failing that the system picks a spot itself — the middle of the biggest room
 * on the lowest floor, nudged until the body fits. The same search answers
 * "put me somewhere safe on floor 2" for the floor jump and the fall rescue.
 */

import type { Project, SpawnPoint } from '@interior/core';
import { polygonArea, polygonCentroid, bbox, pointInPolygon } from '@interior/core';
import { groundAt, isStandable, type BlockQuery, type CollisionWorld, PASS_ALL } from './WalkthroughCollision';
import type { BodyDims } from './WalkSettings';

export interface StartPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  floorId: string;
  /** Spawn id when it came from the project. */
  spawnId?: string;
  name?: string;
}

/** The project's chosen start, or the first saved spawn, or null. */
export function chosenSpawn(project: Project): SpawnPoint | null {
  const wt = project.walkthrough;
  if (!wt || wt.spawns.length === 0) return null;
  return wt.spawns.find((s) => s.id === wt.startSpawnId) ?? wt.spawns[0];
}

/** A spawn point, verified against the world and nudged onto the floor. */
export function poseFromSpawn(project: Project, world: CollisionWorld, spawn: SpawnPoint, body: BodyDims, q: BlockQuery = PASS_ALL): StartPose | null {
  const floor = project.floors.find((f) => f.id === spawn.floorId && f.visible);
  if (!floor) return null;
  const g = groundAt(world, spawn.x, spawn.z, floor.elevation + 0.4, body.stepUp + 0.4);
  const y = g ? g.y : floor.elevation;
  if (isStandable(world, spawn.x, spawn.z, y, body, q)) {
    return { x: spawn.x, y, z: spawn.z, yaw: spawn.yaw, floorId: floor.id, spawnId: spawn.id, name: spawn.name };
  }
  const near = safePointOnFloor(project, world, floor.id, { x: spawn.x, z: spawn.z }, body, q);
  return near ? { ...near, yaw: spawn.yaw, spawnId: spawn.id, name: spawn.name } : null;
}

/** The pose a fresh walkthrough starts from. Never fails: there is always the origin. */
export function resolveStart(project: Project, world: CollisionWorld, body: BodyDims, q: BlockQuery = PASS_ALL): StartPose {
  const spawn = chosenSpawn(project);
  if (spawn) {
    const pose = poseFromSpawn(project, world, spawn, body, q);
    if (pose) return pose;
  }
  return autoSpawn(project, world, body, q);
}

/** Lowest visible floor, biggest room, facing into the room. */
export function autoSpawn(project: Project, world: CollisionWorld, body: BodyDims, q: BlockQuery = PASS_ALL): StartPose {
  const floors = project.floors.filter((f) => f.visible).sort((a, b) => a.elevation - b.elevation);
  for (const floor of floors) {
    const pose = safePointOnFloor(project, world, floor.id, null, body, q);
    if (pose) return pose;
  }
  const first = floors[0] ?? project.floors[0];
  const b = world.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const g = groundAt(world, cx, cz, (first?.elevation ?? 0) + 0.4, body.stepUp + 0.4);
  return { x: cx, y: g?.y ?? 0, z: cz, yaw: 0, floorId: first?.id ?? '' };
}

/**
 * A standable point on a floor. With `near`, the closest such point to it;
 * without, the most central point of the largest room. Rooms are sampled on a
 * half-metre grid and a candidate counts only when the body fits there with
 * a little clearance to spare.
 */
export function safePointOnFloor(
  project: Project,
  world: CollisionWorld,
  floorId: string,
  near: { x: number; z: number } | null,
  body: BodyDims,
  q: BlockQuery = PASS_ALL,
): StartPose | null {
  const floor = project.floors.find((f) => f.id === floorId);
  if (!floor) return null;
  const roomy: BodyDims = { ...body, radius: body.radius + 0.15 };
  const rooms = floor.rooms.filter((r) => r.points.length >= 3).sort((a, b) => Math.abs(polygonArea(b.points)) - Math.abs(polygonArea(a.points)));

  // Candidate points: room centroids first, then grid samples per room, then
  // the wall footprint for floors drawn without rooms.
  const samples: { x: number; z: number; room: number; c: { x: number; z: number } }[] = [];
  rooms.forEach((room, ri) => {
    const c = polygonCentroid(room.points);
    samples.push({ x: c.x, z: c.y, room: ri, c: { x: c.x, z: c.y } });
    const bb = bbox(room.points);
    for (let x = bb.min.x + 0.35; x <= bb.max.x - 0.35; x += 0.5) {
      for (let y = bb.min.y + 0.35; y <= bb.max.y - 0.35; y += 0.5) {
        if (pointInPolygon({ x, y }, room.points)) samples.push({ x, z: y, room: ri, c: { x: c.x, z: c.y } });
      }
    }
  });
  if (!rooms.length && floor.walls.length) {
    const bb = bbox(floor.walls.flatMap((w) => [w.a, w.b]));
    const c = { x: (bb.min.x + bb.max.x) / 2, z: (bb.min.y + bb.max.y) / 2 };
    samples.push({ ...c, room: 0, c });
    for (let x = bb.min.x + 0.5; x <= bb.max.x - 0.5; x += 0.5) {
      for (let y = bb.min.y + 0.5; y <= bb.max.y - 0.5; y += 0.5) samples.push({ x, z: y, room: 0, c });
    }
  }
  if (!samples.length) return null;

  let best: { x: number; y: number; z: number; score: number } | null = null;
  for (const s of samples) {
    const g = groundAt(world, s.x, s.z, floor.elevation + 0.4, body.stepUp + 0.4);
    if (!g || Math.abs(g.y - floor.elevation) > 0.35) continue;
    if (!isStandable(world, s.x, s.z, g.y, roomy, q)) continue;
    // Prefer: near the requested point, else central in the biggest room.
    const score = near ? Math.hypot(s.x - near.x, s.z - near.z) : s.room * 100 + Math.hypot(s.x - s.c.x, s.z - s.c.z);
    if (!best || score < best.score) best = { x: s.x, y: g.y, z: s.z, score };
  }
  if (!best) return null;
  // Face the room's centre so the first view is of the room, not a wall.
  const room = rooms[0];
  const c = room ? polygonCentroid(room.points) : null;
  const yaw = c && Math.hypot(c.x - best.x, c.y - best.z) > 0.3 ? Math.atan2(-(c.x - best.x), -(c.y - best.z)) : 0;
  return { x: best.x, y: best.y, z: best.z, yaw, floorId: floor.id };
}

export function newSpawnId(): string {
  return 'spawn-' + Math.random().toString(36).slice(2, 9);
}
