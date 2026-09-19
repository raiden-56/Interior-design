import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createProject, createWall } from '@interior/core';
import type { Project, ProjectObject } from '@interior/core';
import { MeshPool, objectAppearance, wallAppearance, buildFurnitureMesh, buildRoomFloorMesh, placeFurniture } from '@/lib/three/meshes';
import { buildScene, structureSignature, disposeScene, syncInstancedPlant } from '@/lib/three/scene';
import { materialById } from '@/lib/materials';

function obj(over: Partial<ProjectObject> = {}): ProjectObject {
  return {
    id: 'obj-' + Math.random().toString(36).slice(2, 8),
    assetId: 'living-sofa-3-seat',
    name: 'Sofa',
    shape: 'sofa',
    x: 1,
    z: 2,
    rotation: 0,
    scale: 1,
    width: 2,
    depth: 0.9,
    height: 0.8,
    color: '#ff0000',
    materialId: null,
    ...over,
  };
}

test('a material overrides the raw colour and supplies its finish', () => {
  const walnut = materialById('wood-walnut')!;
  const a = objectAppearance(obj({ color: '#ff0000', materialId: 'wood-walnut' }));
  assert.equal(a.color, walnut.color);
  assert.equal(a.roughness, walnut.roughness);
  assert.equal(objectAppearance(obj({ materialId: 'metal-brass' })).metalness, 1);
  assert.ok(objectAppearance(obj({ materialId: 'glass-clear' })).opacity < 1);
});

test('the built furniture mesh actually carries the material colour', () => {
  const pool = new MeshPool();
  const mesh = buildFurnitureMesh(pool, obj({ color: '#ff0000', materialId: 'wood-walnut' }));
  const materials: THREE.MeshStandardMaterial[] = [];
  mesh.traverse((o) => {
    if (o instanceof THREE.Mesh) materials.push(o.material as THREE.MeshStandardMaterial);
  });
  assert.ok(materials.length > 0);
  assert.equal(materials[0].color.getHexString(), new THREE.Color(materialById('wood-walnut')!.color).getHexString());
});

test('walls honour their material', () => {
  const w = createWall({ x: 0, y: 0 }, { x: 4, y: 0 });
  w.materialId = 'stone-granite';
  assert.equal(wallAppearance(w).color, materialById('stone-granite')!.color);
});

test('pooled materials survive disposeScene and translucency is keyed, not mutated', () => {
  const pool = new MeshPool();
  const opaque = pool.mat('#bfe3ee', 0.1, 0.1);
  const glass = pool.mat('#bfe3ee', 0.1, 0.1, 0.55);
  assert.notEqual(opaque, glass);
  assert.equal(opaque.transparent, false);

  const p = createProject('t');
  p.floors[0].objects.push(obj());
  const built = buildScene(pool, p, p.floors[0].id);
  disposeScene(built.group, pool);
  assert.ok(pool.owns(pool.mat('#8a8d91', 0.75, 0.05)));
});

test('scale is a transform, so geometry does not depend on it', () => {
  const pool = new MeshPool();
  const size = (g: THREE.Object3D) => {
    let geo: THREE.BufferGeometry | null = null;
    g.traverse((o) => {
      if (!geo && o instanceof THREE.Mesh) geo = o.geometry;
    });
    geo!.computeBoundingBox();
    return geo!.boundingBox!.max.x - geo!.boundingBox!.min.x;
  };
  assert.equal(size(buildFurnitureMesh(pool, obj({ scale: 1 }))), size(buildFurnitureMesh(pool, obj({ scale: 2 }))));
  const m = buildFurnitureMesh(pool, obj());
  placeFurniture(m, obj({ x: 3, z: -1, rotation: 0.5, scale: 1.4 }));
  assert.deepEqual([m.position.x, m.position.y, m.position.z, m.rotation.y, m.scale.x], [3, 0, -1, 0.5, 1.4]);
});

test('structure signature ignores transforms and appearance, catches geometry', () => {
  const p = createProject('t');
  p.floors[0].objects.push(obj({ id: 'obj-fixed' }));
  const o = p.floors[0].objects[0];
  const base = structureSignature(p);
  const withChange = (over: Partial<ProjectObject>) => {
    const snap = { ...o };
    Object.assign(o, over);
    const sig = structureSignature(p);
    Object.assign(o, snap);
    return sig;
  };
  assert.equal(withChange({ x: 9, z: 9, rotation: 2, scale: 1.5, color: '#0f0', materialId: 'metal-brass' }), base);
  assert.notEqual(withChange({ width: 3 }), base);
  assert.notEqual(withChange({ shape: 'bed' }), base);
});

test('walls on an upper floor are not lifted twice', () => {
  const pool = new MeshPool();
  const p: Project = createProject('t');
  const first = p.floors[0];
  const upper = { ...first, id: 'floor-2', name: 'Upper', elevation: 3, walls: [createWall({ x: 0, y: 0 }, { x: 4, y: 0 })], doors: [], windows: [], rooms: [], objects: [] };
  p.floors.push(upper);
  const built = buildScene(pool, p, upper.id);
  const group = built.group.children.find((c) => c.name === `floor:${upper.id}`)!;
  assert.equal(group.position.y, 3, 'floor group carries the elevation');
  const wallMesh = group.children.find((c) => (c.userData.entity as { kind?: string } | undefined)?.kind === 'wall') as THREE.Mesh;
  // Wall is 3 m tall with its base on the floor -> local centre y = 1.5, not 4.5.
  assert.ok(Math.abs(wallMesh.position.y - 1.5) < 1e-6, `wall centre y was ${wallMesh.position.y}`);
});

test('a door on wall A does not cut wall B', () => {
  const pool = new MeshPool();
  const p = createProject('t');
  const floor = p.floors[0];
  const a = createWall({ x: 0, y: 0 }, { x: 4, y: 0 });
  const b = createWall({ x: 0, y: 3 }, { x: 4, y: 3 });
  floor.walls.push(a, b);
  const segmentsOfB = () => {
    let n = 0;
    buildScene(pool, p, floor.id).group.traverse((o) => {
      const e = o.userData.entity as { kind?: string; id?: string } | undefined;
      if (e?.kind === 'wall' && e.id === b.id) n += 1;
    });
    return n;
  };
  const before = segmentsOfB();
  floor.doors.push({ id: 'door-1', kind: 'door', wallId: a.id, offset: 1, width: 0.9, height: 2.1, swing: 0 });
  assert.equal(segmentsOfB(), before);
});

test('batched plants move via the instance buffer', () => {
  const pool = new MeshPool();
  const p = createProject('t');
  p.floors[0].objects.push(obj({ id: 'obj-p1', shape: 'plant' }), obj({ id: 'obj-p2', shape: 'plant', x: 3, z: 3 }));
  const built = buildScene(pool, p, p.floors[0].id);
  assert.ok(built.instanced);
  assert.equal(syncInstancedPlant(built.instanced!, obj({ id: 'obj-p1', shape: 'plant', x: 5, z: 6 }), 0), true);
  const m = new THREE.Matrix4();
  built.instanced!.mesh.getMatrixAt(built.instanced!.index.get('obj-p1')!, m);
  const pos = new THREE.Vector3().setFromMatrixPosition(m);
  assert.deepEqual([pos.x, pos.z], [5, 6]);
});

test('a room slab sits under its own walls, not mirrored across the origin', () => {
  const pool = new MeshPool();
  const room = {
    id: 'room-1',
    name: 'Bedroom',
    points: [
      { x: 0, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 6 },
      { x: 0, y: 6 },
    ],
    color: '#4a68a6',
    materialId: null,
  };
  const mesh = buildRoomFloorMesh(pool, room, 0);
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!;
  // Plan y maps to world z with the same sign the walls use.
  assert.ok(box.min.z > 1.9 && box.max.z < 6.1, `slab z ${box.min.z}..${box.max.z}`);
  assert.ok(box.min.x > -0.1 && box.max.x < 4.1, `slab x ${box.min.x}..${box.max.x}`);
  // Its top face is the floor, so furniture placed at y=0 stands on it.
  assert.ok(Math.abs(box.max.y) < 1e-6, `slab top at ${box.max.y}`);
  assert.ok(box.min.y < 0, 'slab is extruded downward');
});
