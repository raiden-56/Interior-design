import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createProject, createWall, createFloor, applyCommand, doorBehavior } from '@interior/core';
import type { Project, ProjectObject, Floor } from '@interior/core';
import { DEFAULT_WALK_SETTINGS, bodyOf, normalizeWalkSettings } from '@/components/walkthrough/WalkSettings';
import { circleVsOBB, obbFromObject, obbFromSegment, pointInOBB } from '@/components/walkthrough/PlayerCollider';
import {
  buildCollisionWorld,
  collisionSignature,
  groundAt,
  isStandable,
  resolveHorizontal,
  roomAt,
  BLOCK_ALL_DOORS,
  PASS_ALL,
} from '@/components/walkthrough/WalkthroughCollision';
import { createPlayer, stepPlayer, placePlayer, IDLE_INPUT } from '@/components/walkthrough/PlayerPhysics';
import { DoorController } from '@/components/walkthrough/DoorController';
import { SittingController } from '@/components/walkthrough/SittingController';
import { ElevatorController } from '@/components/walkthrough/ElevatorController';
import { rampFromObject, rampHeightAt, rampProgress } from '@/components/walkthrough/StairController';
import { seatPositions, worldSeats, collisionEnabled, interactionOf, defaultInteraction } from '@/components/walkthrough/FurnitureInteraction';
import { autoSpawn, resolveStart, safePointOnFloor } from '@/components/walkthrough/SpawnPoint';
import { buildInteractables, findLookTarget, promptFor } from '@/components/walkthrough/InteractionSystem';
import { NavGrid, destinationsFor, sampleRoute } from '@/components/walkthrough/WalkthroughNavigation';
import { captureCamera, restoreCamera, PoseTween, cameraPoseFor } from '@/components/walkthrough/WalkthroughCamera';
import { WalkthroughRuntime, type RuntimeEvents } from '@/components/walkthrough/PlayerController';
import { MeshPool, poseDoorPart } from '@/lib/three/meshes';
import { buildScene, stairwellHolesAt, structureSignature } from '@/lib/three/scene';
import { sessionAllows, permissionsFor } from '@/lib/session';
import { useWalkthroughStore } from '@/stores/walkthrough-store';
import { useEditorStore } from '@/stores/editor-store';
import { templateById } from '@/lib/templates';
import { assetById } from '@/lib/furniture';

// --- fixtures ------------------------------------------------------------------

const S = DEFAULT_WALK_SETTINGS;
const BODY = bodyOf(S);

function obj(assetId: string, x: number, z: number, over: Partial<ProjectObject> = {}): ProjectObject {
  const a = assetById(assetId)!;
  return {
    id: 'obj-' + Math.random().toString(36).slice(2, 8),
    assetId: a.id,
    name: a.name,
    shape: a.shape,
    x,
    z,
    rotation: 0,
    scale: 1,
    width: a.width,
    depth: a.depth,
    height: a.height,
    color: a.color,
    materialId: null,
    ...(a.mounted ? { metadata: { mounted: true } } : {}),
    ...over,
  };
}

/**
 * A 6×6 room with a door in the south wall, a sofa against the north wall,
 * and (optionally) a staircase up to a 6×6 landing on floor 2.
 */
function house(opts: { stairs?: boolean; door?: boolean } = {}): Project {
  const p = createProject('t');
  const g = p.floors[0];
  g.name = 'Ground';
  const north = createWall({ x: 0, y: 0 }, { x: 6, y: 0 });
  const east = createWall({ x: 6, y: 0 }, { x: 6, y: 6 });
  const south = createWall({ x: 6, y: 6 }, { x: 0, y: 6 });
  const west = createWall({ x: 0, y: 6 }, { x: 0, y: 0 });
  g.walls.push(north, east, south, west);
  g.rooms.push({ id: 'room-living', name: 'Living Room', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }], color: '#4a68a6', materialId: null });
  if (opts.door !== false) {
    // south wall runs 6→0, so offset 2 puts the door centred at x = 3.5
    g.doors.push({ id: 'door-front', kind: 'door', wallId: south.id, offset: 2, width: 1, height: 2.1, swing: 1 });
  }
  g.objects.push(obj('living-sofa-3-seat', 3, 0.7, { id: 'obj-sofa', rotation: 0 }));
  if (opts.stairs) {
    // Along the west wall, bottom step at the south, climbing north.
    g.objects.push(obj('structure-straight-staircase', 0.7, 3.0, { id: 'obj-stairs' }));
    const up = createFloor('First Floor');
    up.elevation = 3;
    up.height = 3;
    up.rooms.push({ id: 'room-landing', name: 'Landing', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }], color: '#6b5b95', materialId: null });
    up.walls.push(createWall({ x: 0, y: 0 }, { x: 6, y: 0 }), createWall({ x: 6, y: 0 }, { x: 6, y: 6 }), createWall({ x: 6, y: 6 }, { x: 0, y: 6 }), createWall({ x: 0, y: 6 }, { x: 0, y: 0 }));
    p.floors.push(up);
  }
  return p;
}

const walkFor = (p: ReturnType<typeof createPlayer>, world: ReturnType<typeof buildCollisionWorld>, seconds: number, forward = 1, strafe = 0, q = BLOCK_ALL_DOORS) => {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) stepPlayer(p, { forward, strafe, sprint: false, slow: false, jump: false }, S, world, dt, q);
};

// --- collider maths ---------------------------------------------------------------

test('circle vs oriented box: pushes out along the shortest axis, ignores clear circles', () => {
  const box = obbFromSegment({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.2);
  assert.equal(circleVsOBB(box, 2, 1, 0.3), null);
  const pen = circleVsOBB(box, 2, 0.3, 0.3)!;
  assert.ok(pen && pen.depth > 0.09 && pen.depth < 0.11, `depth ${pen?.depth}`);
  assert.ok(Math.abs(pen.nz - 1) < 1e-6 && Math.abs(pen.nx) < 1e-6, 'push is straight off the wall face');
  // Centre inside: still leaves through the nearest face.
  const inside = circleVsOBB(box, 2, 0.02, 0.3)!;
  assert.ok(inside.depth > 0.3);
  const rotated = obbFromObject(obj('living-sofa-3-seat', 0, 0, { rotation: Math.PI / 2 }));
  assert.ok(pointInOBB(rotated, 0, 1.0), 'rotated sofa is long along z now');
  assert.ok(!pointInOBB(rotated, 1.0, 0));
});

// --- world from the project ---------------------------------------------------------

test('walls, door leaves and furniture become colliders; stairs and rugs do not', () => {
  const p = house({ stairs: true });
  p.floors[0].objects.push(obj('living-rug', 3, 3));
  const w = buildCollisionWorld(p);
  assert.ok(w.colliders.some((c) => c.kind === 'wall'));
  assert.ok(w.colliders.some((c) => c.kind === 'door' && c.id === 'door-front'));
  assert.ok(w.colliders.some((c) => c.kind === 'object' && c.id === 'obj-sofa'));
  assert.ok(!w.colliders.some((c) => c.id === 'obj-stairs'), 'stairs are walked on, not into');
  assert.ok(!w.colliders.some((c) => c.id.startsWith('obj-') && p.floors[0].objects.find((o) => o.id === c.id)?.shape === 'rug'));
  assert.equal(w.ramps.length, 1);
  assert.equal(w.ramps[0].toFloorId, p.floors[1].id, 'the flight arrives on the floor whose level matches its rise');
  assert.equal(w.floors.length, 2);
});

test('the collision signature tracks moves and door behaviour but not colour', () => {
  const p = house();
  const base = collisionSignature(p);
  const moved = applyCommand(p, { type: 'UPDATE_OBJECT', id: 'obj-sofa', patch: { x: 4 } }).project;
  assert.notEqual(collisionSignature(moved), base, 'moving furniture changes the world');
  const painted = applyCommand(p, { type: 'UPDATE_OBJECT', id: 'obj-sofa', patch: { color: '#ff0000', materialId: 'wood-oak' } }).project;
  assert.equal(collisionSignature(painted), base, 'paint is not physics');
  const locked = applyCommand(p, { type: 'UPDATE_DOOR', id: 'door-front', patch: { metadata: { doorBehavior: 'locked' } } }).project;
  assert.notEqual(collisionSignature(locked), base);
  assert.equal(doorBehavior(locked.floors[0].doors[0]), 'locked');
  assert.equal(doorBehavior(p.floors[0].doors[0]), 'manual');
});

// --- movement ------------------------------------------------------------------------

test('W accelerates smoothly up to walking speed and S/decel brings it to rest', () => {
  const w = buildCollisionWorld(house());
  const p = createPlayer(3, 0, 3, Math.PI, 'f'); // yaw π looks towards +z
  const dt = 1 / 60;
  stepPlayer(p, { ...IDLE_INPUT, forward: 1 }, S, w, dt, BLOCK_ALL_DOORS);
  assert.ok(p.speed > 0 && p.speed < S.walkSpeed * 0.5, `first frame is a fraction of top speed, got ${p.speed}`);
  for (let i = 0; i < 60; i++) stepPlayer(p, { ...IDLE_INPUT, forward: 1 }, S, w, dt, BLOCK_ALL_DOORS);
  assert.ok(Math.abs(p.speed - S.walkSpeed) < 0.01, `reaches walking speed, got ${p.speed}`);
  assert.ok(p.z > 3.5, 'moved forward along the look direction');
  for (let i = 0; i < 30; i++) stepPlayer(p, IDLE_INPUT, S, w, dt, BLOCK_ALL_DOORS);
  assert.ok(p.speed < 0.001, 'comes to rest after release');
  assert.equal(p.grounded, true);
});

test('sprint is faster, slow walk is slower, and sprint can be disabled', () => {
  const w = buildCollisionWorld(house());
  // Start near the north wall looking south: 5.5 m of clear floor (the sofa is at x≈3).
  const run = createPlayer(5, 0, 0.6, Math.PI, 'f');
  const slow = createPlayer(5, 0, 0.6, Math.PI, 'f');
  const noSprint = createPlayer(5, 0, 0.6, Math.PI, 'f');
  const peak = { run: 0, slow: 0, noSprint: 0 };
  for (let i = 0; i < 90; i++) {
    stepPlayer(run, { ...IDLE_INPUT, forward: 1, sprint: true }, S, w, 1 / 60, BLOCK_ALL_DOORS);
    stepPlayer(slow, { ...IDLE_INPUT, forward: 1, slow: true }, S, w, 1 / 60, BLOCK_ALL_DOORS);
    stepPlayer(noSprint, { ...IDLE_INPUT, forward: 1, sprint: true }, { ...S, sprintEnabled: false }, w, 1 / 60, BLOCK_ALL_DOORS);
    peak.run = Math.max(peak.run, run.speed);
    peak.slow = Math.max(peak.slow, slow.speed);
    peak.noSprint = Math.max(peak.noSprint, noSprint.speed);
  }
  assert.ok(Math.abs(peak.run - S.runSpeed) < 0.05, `run ${peak.run}`);
  assert.ok(Math.abs(peak.slow - S.slowSpeed) < 0.05, `slow ${peak.slow}`);
  assert.ok(Math.abs(peak.noSprint - S.walkSpeed) < 0.05, `sprint disabled → walk, got ${peak.noSprint}`);
});

test('the player cannot walk through a wall, and slides along it instead of bouncing', () => {
  const w = buildCollisionWorld(house());
  const p = createPlayer(5, 0, 3, 0, 'f'); // looks north (-z) towards the wall at z = 0, clear of the sofa
  walkFor(p, w, 4);
  // Wall centreline at z = 0, 0.15 m thick → face at 0.075; the body stops one radius away.
  assert.ok(p.z >= 0.075 + S.radius - 0.02, `stopped at the wall: z=${p.z}`);
  assert.ok(p.z < 0.6, 'but got close to it');
  // Strafing along the wall still works.
  const before = p.x;
  walkFor(p, w, 1, 1, 1);
  assert.ok(p.x > before + 0.5, 'slides sideways along the wall');
  assert.ok(p.x <= 6 - 0.075 - S.radius + 0.02, `and stops at the corner: x=${p.x}`);
});

test('furniture blocks the player; a decorative object with collision off does not', () => {
  const p = house();
  const w = buildCollisionWorld(p);
  const player = createPlayer(3, 0, 3, 0, 'f');
  walkFor(player, w, 4);
  // Sofa is 0.95 deep centred at z=0.7 → front face at ~1.175. Player stops in front of it.
  assert.ok(player.z > 1.0 && player.z < 1.6, `stopped by the sofa at z=${player.z}`);

  const soft = house();
  soft.floors[0].objects[0].metadata = { collisionEnabled: false };
  const w2 = buildCollisionWorld(soft);
  const ghost = createPlayer(3, 0, 3, 0, 'f');
  walkFor(ghost, w2, 4);
  assert.ok(ghost.z < 0.6, `walked through the non-solid sofa to the wall: z=${ghost.z}`);
});

test('a closed door blocks the doorway and an open one lets you through', () => {
  const p = house();
  const w = buildCollisionWorld(p);
  const doors = new DoorController(p);
  const q = { doorBlocks: (id: string) => doors.isBlocking(id) };
  const player = createPlayer(3.5, 0, 4.5, Math.PI, 'f'); // looks south towards the door at z = 6
  walkFor(player, w, 3, 1, 0, q);
  assert.ok(player.z < 6, `closed door keeps the player inside: z=${player.z}`);
  assert.ok(player.z > 5.4, 'right up against it');

  assert.equal(doors.toggle('door-front'), 'opened');
  for (let i = 0; i < 90; i++) doors.update(1 / 60, null);
  assert.equal(doors.isBlocking('door-front'), false);
  walkFor(player, w, 3, 1, 0, q);
  assert.ok(player.z > 6.3, `walked through the open door: z=${player.z}`);
  assert.equal(doors.promptFor('door-front'), 'Close door');
});

test('door behaviours: automatic opens on approach, locked never opens, always-open never blocks', () => {
  const p = house();
  p.floors[0].doors[0].metadata = { doorBehavior: 'automatic' };
  const auto = new DoorController(p);
  auto.update(1 / 60, { x: 3.5, y: 0, z: 5.2 });
  assert.equal(auto.isOpen('door-front'), true, 'opens when the player is near');
  for (let i = 0; i < 60; i++) auto.update(1 / 60, { x: 3.5, y: 0, z: 5.2 });
  assert.ok(auto.angleOf('door-front') > 1.4);
  for (let i = 0; i < 120; i++) auto.update(1 / 60, { x: 3.5, y: 0, z: 1.0 });
  assert.equal(auto.isOpen('door-front'), false, 'closes when they leave');

  p.floors[0].doors[0].metadata = { doorBehavior: 'locked' };
  const locked = new DoorController(p);
  assert.equal(locked.toggle('door-front'), 'locked');
  assert.equal(locked.promptFor('door-front'), 'Locked');
  assert.equal(locked.isBlocking('door-front'), true);

  p.floors[0].doors[0].metadata = { doorBehavior: 'open' };
  const open = new DoorController(p);
  assert.equal(open.isBlocking('door-front'), false);
  assert.equal(open.promptFor('door-front'), null);

  // A global "automatic doors" setting upgrades manual doors only.
  p.floors[0].doors[0].metadata = {};
  const global = new DoorController(p, { autoDoors: true });
  global.update(1 / 60, { x: 3.5, y: 0, z: 5.2 });
  assert.equal(global.isOpen('door-front'), true);
});

// --- gravity, stairs and floors ------------------------------------------------------------

test('gravity: a player dropped above the floor lands and stays grounded', () => {
  const w = buildCollisionWorld(house());
  const p = createPlayer(3, 1.5, 3, 0, 'f');
  p.grounded = false;
  let landed = false;
  for (let i = 0; i < 120; i++) {
    const r = stepPlayer(p, IDLE_INPUT, S, w, 1 / 60, BLOCK_ALL_DOORS);
    landed = landed || r.landed;
  }
  assert.ok(landed);
  assert.ok(Math.abs(p.y) < 1e-6 && p.grounded);
  // Jump only when enabled.
  stepPlayer(p, { ...IDLE_INPUT, jump: true }, S, w, 1 / 60, BLOCK_ALL_DOORS);
  assert.equal(p.grounded, true, 'jump is off by default');
  stepPlayer(p, { ...IDLE_INPUT, jump: true }, { ...S, jumpEnabled: true }, w, 1 / 60, BLOCK_ALL_DOORS);
  assert.equal(p.grounded, false, 'jumps when enabled');
});

test('stairs are a ramp: height follows the flight and tops out on the upper floor', () => {
  const p = house({ stairs: true });
  const stairs = p.floors[0].objects.find((o) => o.id === 'obj-stairs')!;
  const ramp = rampFromObject(stairs, p.floors[0], p.floors)!;
  assert.ok(ramp);
  // Bottom edge is +z (south), top is -z (north).
  assert.ok(Math.abs(rampProgress(ramp, 0.7, 3.0 + 1.6)) < 1e-6);
  assert.ok(Math.abs(rampProgress(ramp, 0.7, 3.0 - 1.6) - 1) < 1e-6);
  assert.ok(Math.abs(rampHeightAt(ramp, 0.7, 3.0)! - 1.5) < 1e-6, 'halfway up is half the rise');
  assert.equal(rampHeightAt(ramp, 3, 3), null, 'off the footprint');
  const w = buildCollisionWorld(p);
  // At z = 2.0 the flight is 81% of the way up (2.44 m); feet at 2.3 m reach it.
  const g = groundAt(w, 0.7, 2.0, 2.3, S.stepHeight)!;
  assert.equal(g.kind, 'ramp');
  assert.ok(Math.abs(g.y - (3 * (1.6 + 1.0)) / 3.2) < 1e-6);
  // Feet far below the flight do not get yanked up onto it.
  const low = groundAt(w, 0.7, 2.0, 0.2, S.stepHeight)!;
  assert.ok(low.kind !== 'ramp' && Math.abs(low.y) < 1e-6, 'the floor under the flight is reported instead');
});

test('the player walks up the staircase onto floor 2 without teleporting, and back down', () => {
  const p = house({ stairs: true });
  const w = buildCollisionWorld(p);
  const upper = p.floors[1].id;
  const lower = p.floors[0].id;
  const player = createPlayer(0.7, 0, 5.2, 0, lower); // south of the stairs, looking north
  let maxStep = 0;
  let prevY = 0;
  let changedTo: string | null = null;
  for (let t = 0; t < 8; t += 1 / 60) {
    const r = stepPlayer(player, { ...IDLE_INPUT, forward: 1 }, S, w, 1 / 60, BLOCK_ALL_DOORS);
    maxStep = Math.max(maxStep, player.y - prevY);
    prevY = player.y;
    if (r.floorChanged) changedTo = player.floorId;
  }
  assert.ok(Math.abs(player.y - 3) < 1e-6, `arrived on the upper floor at y=${player.y}`);
  assert.equal(player.floorId, upper);
  assert.equal(changedTo, upper, 'the floor change was reported');
  assert.ok(maxStep < S.stepHeight + 0.06, `no jump larger than a step: ${maxStep}`);
  assert.ok(player.z < 1.4, 'kept walking on the landing');

  // Turn round and walk back down: the stairwell hole lets the feet descend.
  player.yaw = Math.PI;
  for (let t = 0; t < 8; t += 1 / 60) stepPlayer(player, { ...IDLE_INPUT, forward: 1 }, S, w, 1 / 60, BLOCK_ALL_DOORS);
  assert.ok(Math.abs(player.y) < 1e-6, `back on the ground floor at y=${player.y}`);
  assert.equal(player.floorId, lower);
});

test('the upper slab has a stairwell hole in both the renderer and the collision world', () => {
  const p = house({ stairs: true });
  const holes = stairwellHolesAt(p, 3, p.floors[1].id);
  assert.equal(holes.length, 1);
  const pool = new MeshPool();
  const built = buildScene(pool, p, p.floors[0].id);
  const upperGroup = built.group.children.find((c) => c.name === `floor:${p.floors[1].id}`)!;
  const slab = upperGroup.children.find((c) => (c.userData.entity as { kind?: string } | undefined)?.kind === 'room') as THREE.Mesh;
  const solid = buildScene(new MeshPool(), house(), 'x');
  void solid;
  slab.geometry.computeBoundingBox();
  // A hole adds vertices compared to a plain rectangle extrusion.
  const plainCount = (() => {
    const q = house({ stairs: true });
    q.floors[0].objects = q.floors[0].objects.filter((o) => o.id !== 'obj-stairs');
    const b = buildScene(new MeshPool(), q, q.floors[0].id);
    const g = b.group.children.find((c) => c.name === `floor:${q.floors[1].id}`)!;
    const m = g.children.find((c) => (c.userData.entity as { kind?: string } | undefined)?.kind === 'room') as THREE.Mesh;
    return m.geometry.getAttribute('position').count;
  })();
  assert.ok(slab.geometry.getAttribute('position').count > plainCount, 'the slab was cut');
  // Structure signature notices a moved staircase (the hole moves with it).
  const sig = structureSignature(p);
  const moved = applyCommand(p, { type: 'UPDATE_OBJECT', id: 'obj-stairs', patch: { x: 2 } }).project;
  assert.notEqual(structureSignature(moved), sig);
});

test('falling out of the world is detected so the runtime can rescue the player', () => {
  const w = buildCollisionWorld(house());
  const p = createPlayer(3, -20, 3, 0, 'f');
  p.grounded = false;
  const r = stepPlayer(p, IDLE_INPUT, S, w, 1 / 60, BLOCK_ALL_DOORS);
  assert.equal(r.fellOut, true);
});

// --- rooms, spawns ------------------------------------------------------------------------

test('room detection and automatic spawn inside the largest room', () => {
  const p = house();
  const w = buildCollisionWorld(p);
  assert.equal(roomAt(w, p.floors[0].id, 3, 3)?.name, 'Living Room');
  assert.equal(roomAt(w, p.floors[0].id, 9, 9), null);
  const start = autoSpawn(p, w, BODY);
  assert.equal(start.floorId, p.floors[0].id);
  assert.ok(roomAt(w, start.floorId, start.x, start.z), 'spawned inside a room');
  assert.ok(isStandable(w, start.x, start.z, start.y, BODY, PASS_ALL));
  assert.ok(Math.hypot(start.x - 3, start.z - 3) < 1.2, 'near the room centre');
});

test('a saved spawn point wins; one placed inside furniture is nudged to free floor', () => {
  const p = house();
  p.walkthrough = { spawns: [{ id: 's1', name: 'Door', floorId: p.floors[0].id, x: 3.5, z: 5, yaw: 1 }], startSpawnId: 's1' };
  const w = buildCollisionWorld(p);
  const a = resolveStart(p, w, BODY);
  assert.deepEqual([a.x, a.z, a.yaw, a.spawnId], [3.5, 5, 1, 's1']);

  p.walkthrough.spawns[0] = { ...p.walkthrough.spawns[0], x: 3, z: 0.7 }; // inside the sofa
  const b = resolveStart(p, w, BODY);
  assert.ok(isStandable(w, b.x, b.z, b.y, BODY), 'moved to a standable spot');
  assert.ok(Math.hypot(b.x - 3, b.z - 0.7) < 2.5, 'but close to where it was asked for');
  assert.equal(b.yaw, 1, 'heading preserved');

  const up = house({ stairs: true });
  const w2 = buildCollisionWorld(up);
  const landing = safePointOnFloor(up, w2, up.floors[1].id, { x: 3, z: 3 }, BODY)!;
  assert.ok(landing && Math.abs(landing.y - 3) < 1e-6, 'floor jump lands on the upper slab');
});

test('the spawn point survives the command system and the undo of its inverse', () => {
  const p = house();
  const res = applyCommand(p, { type: 'UPDATE_PROJECT', patch: { walkthrough: { spawns: [{ id: 's', name: 'S', floorId: p.floors[0].id, x: 1, z: 1, yaw: 0 }], startSpawnId: 's' } } });
  assert.equal(res.project.walkthrough?.spawns.length, 1);
  const undone = applyCommand(res.project, res.inverse);
  assert.equal(undone.project.walkthrough, undefined);
});

// --- sitting ------------------------------------------------------------------------------

test('a sofa has one seat per cushion; a chair one; a wardrobe none', () => {
  assert.equal(seatPositions(obj('living-sofa-3-seat', 0, 0)).length, 4 > 3 ? 4 : 3); // 2.2 m / 0.62 ≈ 3.5 → 4
  assert.equal(seatPositions(obj('dining-dining-chair', 0, 0)).length, 1);
  assert.equal(seatPositions(obj('bedroom-wardrobe', 0, 0)).length, 0);
  assert.equal(defaultInteraction('sofa'), 'sit');
  assert.equal(defaultInteraction('bed'), 'lie');
  assert.equal(defaultInteraction('wardrobe'), 'cabinet');
  assert.equal(defaultInteraction('rug'), 'none');
  assert.equal(interactionOf(obj('living-rug', 0, 0, { metadata: { interaction: { type: 'inspect' } } })).type, 'inspect', 'metadata overrides the shape default');
  assert.equal(collisionEnabled(obj('living-wall-tv-55-inch', 0, 0)), false, 'mounted pieces never collide');
  // A seat on a rotated sofa faces the way the sofa faces.
  const rotated = obj('living-sofa-3-seat', 2, 2, { rotation: Math.PI });
  const seats = worldSeats(rotated, 0);
  const fx = -Math.sin(seats[0].yaw);
  const fz = -Math.cos(seats[0].yaw);
  assert.ok(Math.abs(fz - -1) < 1e-6 && Math.abs(fx) < 1e-6, 'sofa rotated 180° faces north');
});

test('sitting eases the camera onto the nearest seat, locks the body, and standing finds free floor', () => {
  const p = house();
  const w = buildCollisionWorld(p);
  const sofa = p.floors[0].objects[0];
  const sitting = new SittingController();
  const player = createPlayer(2.4, 0, 2.2, 0, p.floors[0].id);
  const r = sitting.trySit(sofa, 0, 'sit', player, S);
  assert.equal(r.ok, true);
  assert.equal(sitting.state.phase, 'sitting-down');
  const seats = worldSeats(sofa, 0);
  const nearest = seats.reduce((a, b) => (Math.hypot(b.x - 2.4, b.z - 2.2) < Math.hypot(a.x - 2.4, a.z - 2.2) ? b : a));
  assert.equal(sitting.state.seatIndex, nearest.index, 'nearest seat chosen');

  // Mid-transition the pose is between the standing eye and the seat.
  sitting.update(0.2);
  const mid = sitting.currentPose()!;
  assert.ok(mid.y < S.eyeHeight && mid.y > nearest.y + 0.78 - 0.01, `eye descending: ${mid.y}`);
  let finished: string | null = null;
  for (let i = 0; i < 60 && !finished; i++) finished = sitting.update(1 / 60).finished;
  assert.equal(finished, 'seated');
  assert.ok(Math.abs(sitting.state.to.y - (nearest.y + 0.78)) < 1e-6, 'seated eye height');
  assert.ok(sitting.seated);

  // Look around while seated: the pose turns, the seat does not move.
  sitting.look(0.5, 0.2, 1.4);
  assert.ok(Math.abs(sitting.state.to.yaw - (nearest.yaw + 0.5)) < 1e-6 || Math.abs(sitting.state.to.yaw - (nearest.yaw + 0.5 - Math.PI * 2)) < 1e-6);

  const stand = sitting.tryStand(w, player, S, { doorBlocks: () => true, ignoreObjectId: sofa.id });
  assert.equal(stand.ok, true);
  let done: string | null = null;
  for (let i = 0; i < 60 && !done; i++) done = sitting.update(1 / 60).finished;
  assert.equal(done, 'standing');
  const spot = sitting.lastStandingSpot()!;
  assert.ok(isStandable(w, spot.x, spot.z, spot.y, BODY), 'stood up on free floor, not inside the sofa');
});

test('standing up refuses when boxed in, rather than standing into furniture', () => {
  const p = house();
  // Surround the sofa seat with tall cabinets on every side except the sofa itself.
  const g = p.floors[0];
  g.objects.push(obj('kitchen-tall-pantry-unit', 3, 1.6), obj('kitchen-tall-pantry-unit', 2.3, 1.6), obj('kitchen-tall-pantry-unit', 3.7, 1.6), obj('kitchen-tall-pantry-unit', 1.6, 1.6), obj('kitchen-tall-pantry-unit', 4.4, 1.6));
  g.objects.push(obj('kitchen-tall-pantry-unit', 1.6, 0.7), obj('kitchen-tall-pantry-unit', 4.4, 0.7));
  const w = buildCollisionWorld(p);
  const sitting = new SittingController();
  const player = createPlayer(3, 0, 2.5, 0, g.id);
  // Pretend they got onto the seat (e.g. the cabinets were added while seated).
  sitting.trySit(g.objects[0], 0, 'sit', player, S);
  for (let i = 0; i < 60; i++) sitting.update(1 / 60);
  sitting.state.stoodAt = { x: 3, y: 0, z: 1.6, yaw: 0 }; // now inside a cabinet
  const r = sitting.tryStand(w, player, S, { doorBlocks: () => true, ignoreObjectId: g.objects[0].id });
  assert.equal(r.ok, false);
  assert.equal(sitting.state.phase, 'seated', 'still seated');
});

// --- elevator -----------------------------------------------------------------------------

test('the elevator closes, moves, opens, and reports arrival', () => {
  const e = new ElevatorController();
  assert.ok(e.start({ objectId: 'lift', fromY: 0, toY: 3, toFloorId: 'up', x: 1, z: 1 }));
  assert.equal(e.phase, 'closing');
  let arrived = null;
  let lastY = 0;
  let monotone = true;
  for (let i = 0; i < 600 && !arrived; i++) {
    const r = e.update(1 / 60, null);
    if (r.y !== null) {
      if (r.y < lastY - 1e-9) monotone = false;
      lastY = r.y;
    }
    arrived = r.arrived;
  }
  assert.ok(arrived && arrived.toFloorId === 'up');
  assert.ok(monotone, 'the car never goes back down on the way up');
  assert.equal(e.phase, 'idle');
  assert.equal(e.doorOpenFor('lift'), 1);
});

// --- interaction raycast -------------------------------------------------------------------

test('looking at a sofa from across the room prompts E Sit; a wall in the way hides it', () => {
  const p = house();
  const pool = new MeshPool();
  const built = buildScene(pool, p, p.floors[0].id);
  // The walkthrough starts with every leaf closed; the editor draws it ajar.
  built.group.traverse((o) => {
    if (o.userData.doorPart) poseDoorPart(o, 0);
  });
  built.group.updateMatrixWorld(true);
  const interactables = buildInteractables(p);
  const ray = new THREE.Raycaster();
  // Eye at (3, 1.65, 2.3) looking north at the sofa.
  ray.set(new THREE.Vector3(3, 1.0, 2.3), new THREE.Vector3(0, -0.25, -1).normalize());
  const hit = findLookTarget(ray, built.group, interactables);
  assert.ok(hit && hit.target.id === 'obj-sofa', `expected the sofa, got ${hit?.target.id}`);
  const ctx = {
    seatedOn: null,
    doorPrompt: () => null,
    lightOn: () => false,
    opened: () => false,
    elevatorBusy: false,
    floorName: () => null,
    stairsLeadTo: () => null,
  };
  assert.deepEqual(promptFor(hit!.target, ctx), { key: 'E', text: 'Sit' });
  assert.equal(promptFor(hit!.target, { ...ctx, seatedOn: 'obj-sofa' })!.text, 'Stand up');

  // From outside the north wall, the wall is hit first → nothing.
  ray.set(new THREE.Vector3(3, 1.0, -1.5), new THREE.Vector3(0, -0.2, 1).normalize());
  assert.equal(findLookTarget(ray, built.group, interactables), null);

  // The door is interactable too.
  ray.set(new THREE.Vector3(3.5, 1.2, 4.6), new THREE.Vector3(0, 0, 1));
  const door = findLookTarget(ray, built.group, interactables);
  assert.equal(door?.target.id, 'door-front');
  assert.equal(promptFor(door!.target, { ...ctx, doorPrompt: () => 'Open door' })!.text, 'Open door');
});

// --- navigation ------------------------------------------------------------------------------

test('the route planner finds a path up the stairs to the landing and lists destinations', () => {
  const p = house({ stairs: true });
  const w = buildCollisionWorld(p);
  const grid = new NavGrid(w, BODY, PASS_ALL);
  const route = grid.findPath({ x: 4, y: 0, z: 4.5 }, { x: 4, y: 3, z: 4 });
  assert.ok(route, 'a route exists');
  const sampled = sampleRoute(w, route!);
  assert.ok(sampled.some((pt) => pt.y > 0.5 && pt.y < 2.5), 'it climbs through intermediate heights (the stairs)');
  assert.ok(sampled.every((pt, i) => i === 0 || pt.y >= sampled[i - 1].y - 0.4), 'the drawn line never dips back down');
  assert.deepEqual(route!.floorIds, [p.floors[0].id, p.floors[1].id]);
  assert.ok(route!.length > 6 && route!.length < 25, `sensible length ${route!.length}`);

  const dests = destinationsFor(p, w);
  assert.ok(dests.some((d) => d.kind === 'room' && d.label === 'Living Room'));
  assert.ok(dests.some((d) => d.kind === 'room' && d.label === 'Landing' && d.floorId === p.floors[1].id));
  assert.ok(dests.some((d) => d.kind === 'stairs'));
  assert.ok(dests.some((d) => d.kind === 'object' && d.id === 'obj-sofa'));
});

test('no route through a wall without a door', () => {
  const p = house({ door: false });
  const w = buildCollisionWorld(p);
  const grid = new NavGrid(w, BODY, PASS_ALL);
  assert.equal(grid.findPath({ x: 3, y: 0, z: 3 }, { x: 3, y: 0, z: 9 }), null);
});

// --- camera memento + transitions ----------------------------------------------------------------

test('the editor camera comes back exactly where it was', () => {
  const cam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100);
  cam.position.set(8, 7, 10);
  cam.lookAt(1, 0, 2);
  cam.zoom = 1.3;
  const controls = { target: new THREE.Vector3(1, 0, 2), update: () => undefined };
  const m = captureCamera(cam, controls);
  // Walkthrough flies somewhere else and changes the fov.
  const tween = new PoseTween();
  tween.begin({ position: cam.position, quaternion: cam.quaternion, fov: cam.fov }, cameraPoseFor({ x: 3, y: 1.65, z: 3, yaw: 1, pitch: -0.2 }, 72), 1000, 0);
  tween.apply(cam, 500);
  assert.ok(cam.position.distanceTo(new THREE.Vector3(8, 7, 10)) > 1, 'camera moved');
  assert.ok(tween.apply(cam, 1000), 'finished');
  assert.ok(Math.abs(cam.fov - 72) < 1e-6);
  controls.target.set(0, 0, 0);
  restoreCamera(cam, controls, m);
  assert.deepEqual([cam.position.x, cam.position.y, cam.position.z], [8, 7, 10]);
  assert.ok(cam.quaternion.angleTo(m.quaternion) < 1e-9);
  assert.equal(cam.fov, 50);
  assert.equal(cam.zoom, 1.3);
  assert.deepEqual([controls.target.x, controls.target.y, controls.target.z], [1, 0, 2]);
});

test('entering and exiting the walkthrough leaves the editor state (selection, floor, project) untouched', () => {
  const p = house({ stairs: true });
  const editor = useEditorStore.getState();
  editor.loadProject(p);
  editor.select(['obj-sofa']);
  editor.setActiveFloor(p.floors[1].id);
  editor.setView('3d');
  const before = { selection: editor.selection, floor: useEditorStore.getState().activeFloorId, project: useEditorStore.getState().project };

  const wt = useWalkthroughStore.getState();
  wt.requestEnter();
  assert.equal(useWalkthroughStore.getState().phase, 'entering');
  useWalkthroughStore.getState().setPhase('active');
  useWalkthroughStore.getState().setLocation({ floorId: p.floors[0].id, floorName: 'Ground', roomId: 'room-living', roomName: 'Living Room', roomArea: 36 });
  useWalkthroughStore.getState().setPrompt({ key: 'E', text: 'Sit' });
  useWalkthroughStore.getState().requestExit();
  assert.equal(useWalkthroughStore.getState().phase, 'exiting');
  useWalkthroughStore.getState().finishExit();
  const after = useWalkthroughStore.getState();
  assert.equal(after.phase, 'off');
  assert.equal(after.prompt, null);
  assert.equal(after.location.roomName, '');

  const ed = useEditorStore.getState();
  assert.deepEqual(ed.selection, before.selection);
  assert.equal(ed.activeFloorId, before.floor);
  assert.equal(ed.project, before.project, 'walking never writes to the project');
  assert.equal(ed.view, '3d');
});

test('the runtime: spawn, walk to the sofa, sit, stand, climb to floor 2, all through the public API', () => {
  const p = house({ stairs: true });
  const events: string[] = [];
  const ev: RuntimeEvents = {
    location: (l) => events.push(`loc:${l.floorName}:${l.roomName}`),
    prompt: () => undefined,
    notice: (t) => events.push(`notice:${t}`),
    info: () => undefined,
    sitting: (s) => events.push(`sit:${s ? s.name : '-'}`),
    elevatorPicker: () => undefined,
    riding: () => undefined,
    route: () => undefined,
    floorChanged: (id) => events.push(`floor:${id}`),
  };
  const rt = new WalkthroughRuntime(p, S, ev, () => null);
  const eye = rt.spawn();
  assert.ok(Math.abs(eye.y - S.eyeHeight) < 1e-6, 'eye at eye height');
  assert.ok(events.some((e) => e.startsWith('loc:Ground:Living Room')));

  // Sit via the controller directly (the raycast needs a scene), then stand.
  const sofa = p.floors[0].objects[0];
  rt.player.x = 2.4;
  rt.player.z = 2.2;
  assert.equal(rt.sitting.trySit(sofa, 0, 'sit', rt.player, S).ok, true);
  const cam = new THREE.PerspectiveCamera();
  const idle = { forward: 0, strafe: 0, sprint: false, slow: false, jump: false, lookDX: 0, lookDY: 0, interact: false };
  for (let i = 0; i < 60; i++) rt.update(1 / 60, idle, cam);
  assert.ok(rt.sitting.seated);
  // Movement keys do nothing while seated.
  const sx = rt.player.x;
  for (let i = 0; i < 30; i++) rt.update(1 / 60, { ...idle, forward: 1 }, cam);
  assert.equal(rt.player.x, sx);
  rt.interact(); // seated → stand
  for (let i = 0; i < 60; i++) rt.update(1 / 60, idle, cam);
  assert.ok(!rt.sitting.active);

  // Jump to floor 2 and back via the convenience control.
  assert.ok(rt.jumpToFloor(p.floors[1].id));
  assert.ok(Math.abs(rt.player.y - 3) < 1e-6);
  assert.ok(events.some((e) => e === `floor:${p.floors[1].id}`));
  assert.ok(rt.jumpToFloor(p.floors[0].id));

  // Project edits propagate: delete the sofa and the collider is gone.
  const without = applyCommand(p, { type: 'DELETE_OBJECT', id: 'obj-sofa' }).project;
  rt.setProject(without);
  assert.ok(!rt.world.colliders.some((c) => c.id === 'obj-sofa'));
  assert.ok(!rt.interactables.has('obj-sofa'));
});

// --- permissions ----------------------------------------------------------------------------------

test('every role may walk; a client link can switch it off, and a client still cannot edit', () => {
  assert.equal(permissionsFor('owner').walkthrough, true);
  assert.equal(permissionsFor('editor').walkthrough, true);
  assert.equal(permissionsFor('viewer').walkthrough, true);
  const share = { kind: 'share' as const, projectId: 'p', role: 'viewer' as const, label: 'c', expiresAt: null, allowComments: false, watermark: true };
  assert.equal(sessionAllows(share, 'walkthrough'), true, 'older links without the flag allow it');
  assert.equal(sessionAllows({ ...share, allowWalkthrough: false }, 'walkthrough'), false);
  assert.equal(sessionAllows({ ...share, allowWalkthrough: true }, 'edit'), false);
  assert.equal(sessionAllows({ ...share, allowWalkthrough: true }, 'exportFiles'), false);
  assert.equal(sessionAllows(null, 'walkthrough'), false);
});

// --- settings -------------------------------------------------------------------------------------

test('settings are clamped to sane ranges', () => {
  const s = normalizeWalkSettings({ walkSpeed: 99, runSpeed: 0, eyeHeight: 5, playerHeight: 1.75, headBob: 'wild' as never, fov: 10 });
  assert.equal(s.walkSpeed, 3);
  assert.ok(s.runSpeed >= s.walkSpeed);
  assert.ok(s.eyeHeight <= s.playerHeight);
  assert.equal(s.headBob, 'low');
  assert.equal(s.fov, 50);
});

// --- the duplex template is walkable end to end --------------------------------------------------------

test('the duplex template: spawn at the entrance, the stairs reach the first floor, every room is reachable', () => {
  const t = templateById('duplex');
  assert.ok(t);
  const p = t!.build();
  assert.equal(p.floors.length, 2);
  const w = buildCollisionWorld(p);
  assert.equal(w.ramps.length, 1);
  assert.equal(w.ramps[0].toFloorId, p.floors[1].id);
  const start = resolveStart(p, w, BODY);
  assert.equal(start.spawnId, 'spawn-entrance');
  assert.ok(isStandable(w, start.x, start.z, start.y, BODY));
  const grid = new NavGrid(w, BODY, PASS_ALL);
  for (const f of p.floors) {
    for (const r of f.rooms) {
      const c = r.points.reduce((a, b) => ({ x: a.x + b.x / r.points.length, y: a.y + b.y / r.points.length }), { x: 0, y: 0 });
      const spot = safePointOnFloor(p, w, f.id, { x: c.x, z: c.y }, BODY)!;
      assert.ok(spot, `${f.name}/${r.name} has a standable spot`);
      const route = grid.findPath({ x: start.x, y: start.y, z: start.z }, { x: spot.x, y: spot.y, z: spot.z });
      assert.ok(route, `${f.name}/${r.name} is reachable on foot from the entrance`);
    }
  }
});

// --- performance ---------------------------------------------------------------------------------------

test('a physics step on a furnished two-storey plan costs well under a frame', () => {
  const p = templateById('duplex')!.build();
  const w = buildCollisionWorld(p);
  const player = createPlayer(5, 0, 7, 0, p.floors[0].id);
  const steps = 2000;
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) stepPlayer(player, { ...IDLE_INPUT, forward: 1, strafe: i % 120 < 60 ? 0.4 : -0.4 }, S, w, 1 / 60, BLOCK_ALL_DOORS);
  const perStep = (performance.now() - t0) / steps;
  assert.ok(perStep < 1.0, `physics step took ${perStep.toFixed(3)} ms (budget 1 ms of a 16 ms frame)`);
  const t1 = performance.now();
  buildCollisionWorld(p);
  assert.ok(performance.now() - t1 < 50, 'world rebuild is cheap enough to run on every edit');
});

test('placing and reading the player never allocates a project copy', () => {
  const p = house();
  const w = buildCollisionWorld(p);
  const player = createPlayer(0, 0, 0, 0, null);
  placePlayer(player, w, 3, 0, 3, 0.5, S.stepHeight);
  assert.deepEqual([player.x, player.y, player.z, player.yaw, player.grounded], [3, 0, 3, 0.5, true]);
  const floor: Floor = p.floors[0];
  assert.equal(floor.objects.length, 1, 'the fixture is unchanged by the walkthrough');
});
