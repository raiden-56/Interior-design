'use client';

/**
 * 3D scene assembly — pure function from canonical model to a THREE.Group.
 * Two rendering adapters (2D Pixi, 3D Three) both derive purely from the model.
 */

import * as THREE from 'three';
import type { Floor, Project } from '@interior/core';
import {
  MeshPool,
  buildWallSegmentMesh,
  buildRoomFloorMesh,
  buildGroundMesh,
  buildFurnitureMesh,
  placeFurniture,
  appearanceKey,
  objectAppearance,
} from './meshes';

/** The instanced batch that renders repeated plants, plus id -> slot. */
export interface InstancedBatch {
  mesh: THREE.InstancedMesh;
  index: Map<string, number>;
}

export interface SceneBuild {
  group: THREE.Group;
  /** entityId -> Object3D, used for transform gizmos + selection. */
  entities: Map<string, THREE.Object3D>;
  /** Present only when enough plants existed to batch them. */
  instanced: InstancedBatch | null;
}

export function buildScene(pool: MeshPool, project: Project, activeFloorId: string): SceneBuild {
  const group = new THREE.Group();
  group.name = 'world';
  const entities = new Map<string, THREE.Object3D>();

  // Ground plane.
  const ground = buildGroundMesh(pool, [], 600);
  group.add(ground);

  const plants: { obj: import('@interior/core').ProjectObject; floor: Floor }[] = [];

  for (const floor of project.floors) {
    if (!floor.visible) continue;
    const floorGroup = new THREE.Group();
    floorGroup.name = `floor:${floor.id}`;
    floorGroup.position.y = floor.elevation;

    for (const wall of floor.walls) {
      // Only this wall's own openings. Passing the whole floor's doors and
      // windows cut every opening into every wall, so any plan with more than
      // one wall came out riddled with holes that belonged elsewhere.
      const wallDoors = floor.doors.filter((d) => d.wallId === wall.id);
      const wallWindows = floor.windows.filter((w) => w.wallId === wall.id);
      // Positions are local to `floorGroup`, which already carries the floor's
      // elevation. Baking the elevation into the meshes as well lifted every
      // wall on an upper floor twice as high as its floor slab.
      const { meshes } = buildWallSegmentMesh(pool, wall, wallDoors, wallWindows, wall.height, 0);
      for (const m of meshes) {
        m.traverse(() => undefined);
        if (m.userData.entity) {
          const e = m.userData.entity as { kind: string; id: string };
          if (e.kind === 'wall' && !entities.has(e.id)) {
            m.userData.groupEntity = { kind: 'wall', id: e.id };
            entities.set(e.id, m);
          }
        }
        floorGroup.add(m);
      }
    }

    for (const room of floor.rooms) {
      const m = buildRoomFloorMesh(pool, room, 0);
      m.userData.entity = { kind: 'room', id: room.id };
      floorGroup.add(m);
      if (!entities.has(room.id)) entities.set(room.id, m);
    }

    for (const door of floor.doors) {
      const marker = findEntity(floorGroup, 'door', door.id);
      if (marker && !entities.has(door.id)) entities.set(door.id, marker);
    }
    for (const wnd of floor.windows) {
      const glass = findEntity(floorGroup, 'window', wnd.id);
      if (glass && !entities.has(wnd.id)) entities.set(wnd.id, glass);
    }

    for (const obj of floor.objects) {
      if (obj.shape === 'plant') {
        plants.push({ obj, floor });
        continue;
      }
      const mesh = buildFurnitureMesh(pool, obj);
      tagObject(mesh, obj);
      placeFurniture(mesh, obj);
      floorGroup.add(mesh);
      entities.set(obj.id, mesh);
    }

    group.add(floorGroup);
  }

  const instanced = buildInstancedPlants(pool, plants, group, entities);

  return { group, entities, instanced };
}

/**
 * Stamps identity and current look onto a furniture group. The appearance key
 * lets the renderer tell a cheap transform update (reposition in place) from
 * one that needs the group rebuilt (different colour or material).
 */
export function tagObject(mesh: THREE.Object3D, obj: import('@interior/core').ProjectObject): void {
  mesh.userData.entity = { kind: 'object', id: obj.id };
  mesh.userData.objId = obj.id;
  mesh.userData.appearanceKey = appearanceKey(obj.materialId, obj.color);
}

function findEntity(floorGroup: THREE.Group, kind: string, id: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  floorGroup.traverse((o) => {
    const e = o.userData.entity as { kind?: string; id?: string } | undefined;
    if (e && e.kind === kind && e.id === id) found = o;
  });
  return found;
}

/**
 * Instanced rendering for repeated plants — one draw call for all of them.
 */
function buildInstancedPlants(
  pool: MeshPool,
  plants: { obj: import('@interior/core').ProjectObject; floor: Floor }[],
  group: THREE.Group,
  entities: Map<string, THREE.Object3D>,
): InstancedBatch | null {
  if (plants.length < 2) {
    for (const { obj, floor } of plants) {
      const mesh = buildFurnitureMesh(pool, obj);
      tagObject(mesh, obj);
      placeFurniture(mesh, obj);
      const host = group.children.find((c) => (c as THREE.Object3D).name === `floor:${floor.id}`);
      (host ?? group).add(mesh);
      entities.set(obj.id, mesh);
    }
    return null;
  }

  const geo = new THREE.IcosahedronGeometry(0.28, 1);
  const mat = pool.mat('#4d9a5e', 0.9, 0);
  const inst = new THREE.InstancedMesh(geo, mat, plants.length);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const scaleV = new THREE.Vector3();
  const posV = new THREE.Vector3();
  const instanceEntities: import('@interior/core').ProjectObject[] = [];
  const index = new Map<string, number>();
  let i = 0;
  for (const { obj, floor } of plants) {
    index.set(obj.id, i);
    const y = floor.elevation + obj.height * 0.45;
    posV.set(obj.x, y, obj.z);
    euler.set(0, obj.rotation, 0);
    quat.setFromEuler(euler);
    scaleV.set(obj.scale, obj.scale, obj.scale);
    m.compose(posV, quat, scaleV);
    inst.setMatrixAt(i, m);
    color.set(objectAppearance(obj).color);
    inst.setColorAt(i, color);
    instanceEntities.push(obj);
    i += 1;
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.userData.instanceEntities = instanceEntities;
  group.add(inst);
  return { mesh: inst, index };
}

/**
 * Writes one plant's transform and colour into its instanced slot, so moving
 * a batched plant costs a buffer write rather than a full scene rebuild.
 */
export function syncInstancedPlant(
  batch: InstancedBatch,
  obj: import('@interior/core').ProjectObject,
  elevation: number,
): boolean {
  const slot = batch.index.get(obj.id);
  if (slot === undefined) return false;
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, obj.rotation, 0));
  m.compose(
    new THREE.Vector3(obj.x, elevation + obj.height * 0.45, obj.z),
    quat,
    new THREE.Vector3(obj.scale, obj.scale, obj.scale),
  );
  batch.mesh.setMatrixAt(slot, m);
  batch.mesh.instanceMatrix.needsUpdate = true;
  batch.mesh.setColorAt(slot, new THREE.Color(objectAppearance(obj).color));
  if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
  return true;
}

/**
 * Signature of everything that requires geometry to be rebuilt.
 *
 * Deliberately excludes each object's position, rotation, scale, colour and
 * material: the renderer applies those in place. Rebuilding the entire scene
 * on every commit and every slider tick is what made the transform gizmo
 * detach from its target and the viewport flicker.
 */
export function structureSignature(project: Project): string {
  const parts: string[] = [];
  for (const f of project.floors) {
    if (!f.visible) {
      parts.push('f:' + f.id + ':hidden');
      continue;
    }
    parts.push(`f:${f.id}:${f.elevation}`);
    for (const w of f.walls) {
      parts.push(`w:${w.id}:${w.a.x},${w.a.y},${w.b.x},${w.b.y},${w.height},${w.thickness},${w.color},${w.materialId}`);
    }
    for (const d of f.doors) parts.push(`d:${d.id}:${d.wallId},${d.offset},${d.width},${d.height}`);
    for (const n of f.windows) parts.push(`n:${n.id}:${n.wallId},${n.offset},${n.width},${n.height},${n.sill}`);
    for (const r of f.rooms) {
      parts.push(`r:${r.id}:${r.color},${r.materialId},${r.points.map((p) => p.x + ',' + p.y).join(';')}`);
    }
    // Object geometry only — shape and footprint change the mesh itself.
    for (const o of f.objects) parts.push(`o:${o.id}:${o.shape},${o.width},${o.depth},${o.height}`);
  }
  return parts.join('|');
}

/**
 * Disposes the geometry created for one build, leaving the pool's shared
 * materials intact.
 *
 * This used to take a `Set` of pooled materials which the caller created empty
 * and never populated, so the guard never matched: every shared material was
 * disposed on each rebuild while the pool kept handing the same disposed
 * instances straight back out. Asking the pool directly removes the chance of
 * the two getting out of sync.
 */
export function disposeScene(root: THREE.Object3D, pool: MeshPool): void {
  root.traverse((o) => {
    // InstancedMesh extends Mesh, so this covers both.
    if (o instanceof THREE.Mesh) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && !pool.owns(m)) m.dispose();
      }
    }
  });
}