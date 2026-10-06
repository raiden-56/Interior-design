import * as THREE from 'three';
import type { Door, Room, Vec2, Wall, Window, ProjectObject } from '@interior/core';
import { wallDir, wallLength, pointOnWall, pointInPolygon } from '@interior/core';
import { materialById } from '@/lib/materials';

/**
 * 3D geometry builders. These are PURE functions: given canonical model data
 * they return fresh Three.js geometry. The renderer adapters rebuild/update
 * geometry when the model changes — Three.js never stores model truth.
 */

export class MeshPool {
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  /**
   * Every material this pool has handed out. `disposeScene` consults this so
   * it never disposes a shared material the pool will hand back on the next
   * rebuild — a disposed material loses its compiled program and can render
   * flat or black until Three.js rebuilds it.
   */
  private owned = new Set<THREE.Material>();

  mat(color: string, roughness = 0.8, metalness = 0, opacity = 1): THREE.MeshStandardMaterial {
    // `opacity` belongs in the key. It used to be applied by mutating the
    // material after the fact, which silently turned every *other* mesh
    // sharing that colour and finish translucent as well.
    const key = `${color}|${roughness}|${metalness}|${opacity}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
      });
      this.mats.set(key, m);
      this.owned.add(m);
    }
    return m;
  }

  /** Convenience for the resolved-appearance form. */
  fromAppearance(a: Appearance): THREE.MeshStandardMaterial {
    return this.mat(a.color, a.roughness, a.metalness, a.opacity);
  }

  /** True when this pool created (and still shares) the material. */
  owns(material: THREE.Material): boolean {
    return this.owned.has(material);
  }

  /** Releases every pooled material. Only for tearing the session down. */
  disposeAll(): void {
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    this.owned.clear();
  }
}

// --- appearance resolution ---------------------------------------------------

export interface Appearance {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
}

/**
 * Turns an entity's `materialId` + `color` into a concrete surface.
 *
 * Walls, rooms and objects have all carried `materialId` in the model from the
 * start, and the UI offers the material library — but these builders only ever
 * read the raw `color`, so picking "Walnut" or "Brass" changed nothing on
 * screen and every surface rendered with a default finish. A material now wins
 * over the raw colour and also supplies roughness, metalness and (for glass)
 * translucency. Choosing a custom colour in the properties panel clears
 * `materialId`, so that control keeps working too.
 */
export function resolveAppearance(
  materialId: string | null | undefined,
  color: string | null | undefined,
  fallback: { color: string; roughness: number; metalness: number },
): Appearance {
  const material = materialById(materialId ?? null);
  if (material) {
    return {
      color: material.color,
      roughness: material.roughness,
      metalness: material.metalness,
      // Glass only reads as glass if light passes through it.
      opacity: material.category === 'glass' ? 0.45 : 1,
    };
  }
  return {
    color: color ?? fallback.color,
    roughness: fallback.roughness,
    metalness: fallback.metalness,
    opacity: 1,
  };
}

/** Identity of an entity's look, for change detection during in-place sync. */
export function appearanceKey(materialId: string | null | undefined, color: string | null | undefined): string {
  return `${materialId ?? '-'}|${color ?? '-'}`;
}

const OBJECT_FALLBACK = { color: '#8a8d91', roughness: 0.75, metalness: 0.05 } as const;

export function objectAppearance(obj: ProjectObject): Appearance {
  return resolveAppearance(obj.materialId, obj.color, OBJECT_FALLBACK);
}

export function wallAppearance(wall: Wall): Appearance {
  return resolveAppearance(wall.materialId, wall.color, { color: wall.color, roughness: 0.85, metalness: 0 });
}

export function roomAppearance(room: Room): Appearance {
  return resolveAppearance(room.materialId, room.color, { color: room.color, roughness: 0.6, metalness: 0 });
}

// --- walls with door/window openings -----------------------------------------

/** Optional tagger receives every mesh plus the entity it belongs to. */
export type EntityTag =
  | { kind: 'wall'; id: string }
  | { kind: 'door'; id: string }
  | { kind: 'window'; id: string };

export function buildWallSegmentMesh(
  pool: MeshPool,
  wall: Wall,
  doors: Door[],
  windows: Window[],
  topElevation: number,
  floorElevation: number,
  tag?: (mesh: THREE.Mesh, entity: EntityTag) => void,
): { meshes: THREE.Mesh[]; openingCenters: { x: number; z: number; fullHeight: boolean }[] } {
  const meshes: THREE.Mesh[] = [];
  const openingCenters: { x: number; z: number; fullHeight: boolean }[] = [];

  const L = wallLength(wall);
  const t = wall.thickness;
  const wallHeightTop = floorElevation + wall.height;

  if (L < 1e-4) return { meshes, openingCenters };

  const dir = wallDir(wall);
  const normal = { x: -dir.y, y: dir.x };

  const applyTag = (m: THREE.Mesh, entity: EntityTag) => {
    m.userData.entity = entity;
    if (tag) tag(m, entity);
  };

  // Collect all openings on this wall (clamped + sorted).
  const openings = [
    ...doors.map((d) => ({ offset: Math.min(Math.max(d.offset, 0), Math.max(L - d.width, 0)), width: d.width, height: d.height, full: true as const, kind: 'door' as const, id: d.id, swing: d.swing })),
    ...windows.map((w) => ({ offset: Math.min(Math.max(w.offset, 0), Math.max(L - w.width, 0)), width: w.width, height: w.height, full: false as const, sill: w.sill, kind: 'window' as const, id: w.id })),
  ].sort((a, b) => a.offset - b.offset);

  let cursor = 0;
  for (const o of openings) {
    if (o.offset > cursor + 1e-4) {
      const m = makeSolid(pool, wall, normal, dir, cursor, o.offset - cursor, t, wallHeightTop, floorElevation);
      applyTag(m, { kind: 'wall', id: wall.id });
      meshes.push(m);
    }
    // Header above the opening (door + window).
    const headerBottom = floorElevation + o.height;
    if (headerBottom < wallHeightTop - 1e-4) {
      const m = makeBox(pool, wall, normal, dir, o.offset, o.width, t, headerBottom, wallHeightTop, floorElevation);
      applyTag(m, { kind: 'wall', id: wall.id });
      meshes.push(m);
    }
    // Window sill (below the glass) + glass pane.
    if (o.kind === 'window') {
      const sillTop = floorElevation + o.sill;
      const glassTop = floorElevation + o.height;
      if (sillTop > floorElevation + 1e-4 && o.sill > 0.05) {
        const m = makeBox(pool, wall, normal, dir, o.offset, o.width, t, sillTop - 0.05, sillTop, floorElevation);
        applyTag(m, { kind: 'window', id: o.id });
        meshes.push(m);
      }
      const c = pointOnWall(wall, o.offset + o.width / 2);
      const glassH = Math.max(glassTop - sillTop, 0.05);
      // `sillTop` already includes the floor elevation.
      const m = makeGlass(pool, c.x, c.y, glassH, o.width, t, sillTop);
      applyTag(m, { kind: 'window', id: o.id });
      meshes.push(m);
      openingCenters.push({ x: c.x, z: c.y, fullHeight: false });
    } else {
      const c = pointOnWall(wall, o.offset + o.width / 2);
      openingCenters.push({ x: c.x, z: c.y, fullHeight: true });
      // Frame, hinged leaf and handle — a door people recognise as a door.
      for (const dm of makeDoorParts(pool, wall, dir, normal, o.offset, o.width, t, floorElevation, o.height, o.swing)) {
        applyTag(dm, { kind: 'door', id: o.id });
        meshes.push(dm);
      }
    }
    cursor = o.offset + o.width;
  }
  if (cursor < L - 1e-4) {
    const m = makeSolid(pool, wall, normal, dir, cursor, L - cursor, t, wallHeightTop, floorElevation);
    applyTag(m, { kind: 'wall', id: wall.id });
    meshes.push(m);
  }
  return { meshes, openingCenters };
}

/**
 * A door as a frame plus a hinged leaf, rather than the flat grey slab that
 * used to fill the opening — which read as a blocked doorway in the 3D view.
 * Every part is tagged as the door, so picking and selection still work on any
 * of them.
 */
function makeDoorParts(
  pool: MeshPool,
  wall: Wall,
  dir: { x: number; y: number },
  normal: { x: number; y: number },
  offset: number,
  width: number,
  thickness: number,
  floorElevation: number,
  height: number,
  swing: 0 | 1 | 2,
): THREE.Mesh[] {
  const parts: THREE.Mesh[] = [];
  const frameMat = pool.mat('#cfd4da', 0.7, 0.05);
  const leafMat = pool.mat('#a9825a', 0.65, 0.05);
  const metal = pool.mat('#b9bec4', 0.35, 0.8);
  const jamb = 0.05;
  const depth = Math.min(thickness + 0.02, 0.24);
  const alongWall = (m: THREE.Mesh, at: number, y: number) => {
    const p = pointOnWall(wall, at);
    m.position.set(p.x, y, p.y);
    m.rotation.y = Math.atan2(-dir.y, dir.x);
    m.castShadow = true;
    parts.push(m);
  };

  // Frame: two jambs and a head.
  alongWall(new THREE.Mesh(new THREE.BoxGeometry(jamb, height, depth), frameMat), offset + jamb / 2, floorElevation + height / 2);
  alongWall(new THREE.Mesh(new THREE.BoxGeometry(jamb, height, depth), frameMat), offset + width - jamb / 2, floorElevation + height / 2);
  alongWall(new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, depth), frameMat), offset + width / 2, floorElevation + height - 0.03);

  // Leaf, hinged on the low-offset jamb and standing open into the room.
  const leafW = Math.max(width - jamb * 2, 0.2);
  const leafH = height - 0.06;
  const open = swing === 0 ? 0 : (swing === 2 ? -1 : 1) * 1.15;
  const side = swing === 2 ? -1 : 1;
  const hinge = pointOnWall(wall, offset + jamb);
  const hingeData: DoorHinge = { hinge, dir, normal, side, leafW, leafH, floorElevation, editorAngle: open };

  const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.045), leafMat);
  leaf.castShadow = true;
  leaf.userData.doorPart = 'leaf';
  leaf.userData.doorHinge = hingeData;
  parts.push(leaf);

  // Handle on the free edge of the leaf.
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.03), metal);
  handle.userData.doorPart = 'handle';
  handle.userData.doorHinge = hingeData;
  parts.push(handle);

  // The editor shows the leaf at its hint angle; the walkthrough drives the
  // same two meshes through `poseDoorPart` as the door opens and closes.
  poseDoorPart(leaf, open);
  poseDoorPart(handle, open);

  return parts;
}

/** Everything needed to swing a door leaf about its hinge after the fact. */
export interface DoorHinge {
  hinge: Vec2;
  dir: Vec2;
  normal: Vec2;
  side: 1 | -1;
  leafW: number;
  leafH: number;
  floorElevation: number;
  /** The angle the editor draws it at (its swing hint). */
  editorAngle: number;
}

/**
 * Places a door leaf or handle for a given opening angle (radians, 0 =
 * closed, flush with the wall). Positions are local to the floor group, the
 * same frame `makeDoorParts` builds in, so this is safe to call on a live
 * scene from the walkthrough's animation loop.
 */
export function poseDoorPart(part: THREE.Object3D, angle: number): void {
  const h = part.userData.doorHinge as DoorHinge | undefined;
  if (!h) return;
  const swung = {
    x: h.dir.x * Math.cos(angle) + h.normal.x * Math.sin(angle) * h.side,
    y: h.dir.y * Math.cos(angle) + h.normal.y * Math.sin(angle) * h.side,
  };
  const yaw = Math.atan2(-swung.y, swung.x);
  if (part.userData.doorPart === 'handle') {
    part.position.set(h.hinge.x + swung.x * (h.leafW - 0.11), h.floorElevation + h.leafH * 0.45, h.hinge.y + swung.y * (h.leafW - 0.11));
  } else {
    part.position.set(h.hinge.x + (swung.x * h.leafW) / 2, h.floorElevation + h.leafH / 2, h.hinge.y + (swung.y * h.leafW) / 2);
  }
  part.rotation.y = yaw;
}

function makeSolid(
  pool: MeshPool,
  wall: Wall,
  normal: { x: number; y: number },
  dir: { x: number; y: number },
  from: number,
  len: number,
  t: number,
  top: number,
  bottom: number,
): THREE.Mesh {
  return makeBox(pool, wall, normal, dir, from, len, t, bottom, top, bottom);
}

function makeBox(
  pool: MeshPool,
  wall: Wall,
  normal: { x: number; y: number },
  dir: { x: number; y: number },
  from: number,
  len: number,
  t: number,
  bottom: number,
  top: number,
  floorElevation: number,
): THREE.Mesh {
  if (len <= 1e-4 || top <= bottom + 1e-4) return new THREE.Mesh();
  const center = pointOnWall(wall, from + len / 2);
  const geo = new THREE.BoxGeometry(len, top - bottom, t);
  const mat = pool.fromAppearance(wallAppearance(wall));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(center.x, (top + bottom) / 2, center.y);
  // Rotate so the box's local X axis lies along the wall direction.
  mesh.rotation.y = Math.atan2(-dir.y, dir.x);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  void floorElevation;
  return mesh;
}

function makeGlass(pool: MeshPool, x: number, z: number, height: number, width: number, thickness: number, bottomY: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(width, height, Math.min(thickness, 0.05));
  // Translucency is requested through the pool key rather than set on the
  // returned material, which is shared with every other mesh of that colour.
  const mesh = new THREE.Mesh(geo, pool.mat('#bfe3ee', 0.1, 0.1, 0.55));
  mesh.position.set(x, bottomY + height / 2, z);
  return mesh;
}

// --- floors ------------------------------------------------------------------

/**
 * Plan polygon → extrudable shape, with optional cut-outs.
 *
 * A cut-out is only honoured when it lies entirely inside the outline: the
 * triangulator cannot handle a hole that crosses the boundary, and a stair
 * that pokes through a room's wall is a design mistake the collision warnings
 * already report.
 */
export function planShape(points: Vec2[], holes: Vec2[][] = []): THREE.Shape {
  const s = new THREE.Shape();
  points.forEach((p, i) => {
    if (i === 0) s.moveTo(p.x, p.y);
    else s.lineTo(p.x, p.y);
  });
  s.closePath();
  for (const hole of holes) {
    if (hole.length < 3 || !hole.every((p) => pointInPolygon(p, points))) continue;
    const path = new THREE.Path();
    hole.forEach((p, i) => {
      if (i === 0) path.moveTo(p.x, p.y);
      else path.lineTo(p.x, p.y);
    });
    path.closePath();
    s.holes.push(path);
  }
  return s;
}

export function buildRoomFloorMesh(pool: MeshPool, room: Room, elevation: number, slabThickness = 0.12, holes: Vec2[][] = []): THREE.Mesh {
  if (room.points.length < 3) return new THREE.Mesh();
  // Build the shape (Shape requires moveTo, then lineTo).
  const s = planShape(room.points, holes);
  const geo = new THREE.ExtrudeGeometry(s, { depth: slabThickness, bevelEnabled: false });
  // The shape is drawn in plan coordinates, where y is the world's z. Rotating
  // the other way mapped plan y to -z, so every floor slab was mirrored
  // north-south and slid out from under its own walls. Extruding downward also
  // puts the slab's top face exactly at floor level instead of 12 cm above it,
  // where it swallowed the feet of everything standing on it.
  geo.rotateX(Math.PI / 2);
  geo.translate(0, elevation, 0);
  const mesh = new THREE.Mesh(geo, pool.fromAppearance(roomAppearance(room)));
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A ceiling over a room, for the walkthrough only — the editor leaves rooms
 * open from above so the plan stays readable from the orbit camera. The slab
 * sits with its underside at `y` and casts no shadow, so sunlight still
 * reaches the interior and the rooms do not turn to caves.
 */
export function buildCeilingMesh(pool: MeshPool, room: Room, y: number, holes: Vec2[][] = [], thickness = 0.06): THREE.Mesh {
  if (room.points.length < 3) return new THREE.Mesh();
  const geo = new THREE.ExtrudeGeometry(planShape(room.points, holes), { depth: thickness, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y + thickness, 0);
  const mesh = new THREE.Mesh(geo, pool.mat('#f3f1ec', 0.95, 0));
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.ceiling = true;
  return mesh;
}

export function buildGroundMesh(pool: MeshPool, rooms: Room[], size = 400): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.Mesh(geo, pool.mat('#1d232b', 0.95, 0));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.005;
  mesh.receiveShadow = true;
  return mesh;
}

// --- furniture ---------------------------------------------------------------

export function buildFurnitureMesh(pool: MeshPool, obj: ProjectObject): THREE.Group {
  const group = new THREE.Group();
  // Base dimensions only. `obj.scale` is applied to the group by
  // `placeFurniture`, which keeps geometry independent of scale so a scale
  // change is a cheap transform update rather than a rebuild, and makes the
  // transform gizmo's scale handle map 1:1 onto the model value.
  const w = obj.width;
  const d = obj.depth;
  const h = obj.height;
  // A material from the library wins over the raw colour and brings its own
  // finish; the accent shades are derived from whichever colour won.
  const app = objectAppearance(obj);
  const color = app.color;
  const mat = pool.fromAppearance(app);
  const dark = pool.mat(shade(color, 0.16), Math.min(app.roughness + 0.05, 1), app.metalness, app.opacity);
  const light = pool.mat(tint(color, 0.35), Math.max(app.roughness - 0.05, 0), app.metalness, app.opacity);

  const add = (mesh: THREE.Mesh, x = 0, y = 0, z = 0) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
  };

  switch (obj.shape) {
    case 'sofa': {
      add(prismatic(w, h * 0.38, d, mat), 0, 0, 0);
      add(prismatic(w - 0.12, h * 0.2, d - 0.12, light), 0, 0, 0.01);
      add(prismatic(0.16, h, d + 0.02, dark), -(w / 2 - 0.08), h * 0.31, 0);
      add(prismatic(0.16, h, d + 0.02, dark), w / 2 - 0.08, h * 0.31, 0);
      add(prismatic(w, h * 0.78, 0.14, dark), 0, h * 0.39, -d / 2 + 0.05);
      [0.12, w - 0.12].forEach((px) => add(prismatic(0.05, 0.12, 0.05, dark), px - w / 2 + 0.06, 0, d / 2 - 0.06));
      break;
    }
    case 'lsofa': {
      const long = w;
      const short = d * 0.55;
      add(prismatic(long, h * 0.38, d, mat), 0, 0, 0);
      add(prismatic(short, h * 0.38, short, mat), -long / 2 + short / 2, 0, d / 2 - short / 2);
      add(prismatic(0.16, h, d, dark), long / 2 - 0.08, h * 0.31, 0);
      add(prismatic(long, h * 0.78, 0.14, dark), 0, h * 0.39, -d / 2 + 0.05);
      add(prismatic(short, h * 0.78, 0.14, dark), -long / 2 + short / 2, h * 0.39, d / 2 - 0.02);
      break;
    }
    case 'armchair': {
      add(prismatic(w, h * 0.4, d, mat), 0, 0, 0);
      add(prismatic(0.12, h, d, dark), -(w / 2 - 0.06), h * 0.3, 0);
      add(prismatic(0.12, h, d, dark), w / 2 - 0.06, h * 0.3, 0);
      add(prismatic(w, h * 0.7, 0.12, dark), 0, h * 0.38, -d / 2 + 0.04);
      break;
    }
    case 'ottoman': {
      add(prismatic(w, h * 0.5, d, mat), 0, 0, 0);
      [0.1, w - 0.1].forEach((px) => add(prismatic(0.04, 0.1, 0.04, dark), px - w / 2 + 0.02, 0, -d / 2 + 0.1));
      break;
    }
    case 'coffee-table': {
      add(prismatic(w, 0.05, d, mat), 0, h - 0.025, 0);
      add(prismatic(w * 0.7, 0.03, d * 0.7, light), 0, h * 0.4, 0);
      feet(w, d, 0.04, h * 0.38, dark, add);
      break;
    }
    case 'round-table': {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, 0.05, 32), mat);
      add(cyl, 0, h - 0.025, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, h * 0.9, 12), dark), 0, h * 0.45, 0);
      break;
    }
    case 'tv-unit': {
      add(prismatic(w, 0.1, d, dark), 0, h - 0.05, 0);
      const screen = prismatic(w * 0.96, 0.045, d - 0.02, pool.mat('#0d1117', 0.2, 0.4));
      add(screen, 0, h + 0.045, d / 2 + 0.015);
      feet(w, d, 0.04, h * 0.06, dark, add);
      break;
    }
    case 'shelf': {
      add(prismatic(w, h, 0.3, mat), 0, h / 2, 0);
      [0.25, 0.15, 0.25].forEach((_, i) => {
        const y = h * 0.33 * (i + 1) - 0.02;
        add(prismatic(w - 0.04, 0.04, 0.36, light), 0, y, 0);
      });
      break;
    }
    case 'cabinet': {
      add(prismatic(w, h, d, mat), 0, h / 2, 0);
      add(prismatic(w - 0.04, h * 0.96, 0.02, dark), 0, h * 0.52, d / 2 + 0.005);
      break;
    }
    case 'dining-table': {
      add(prismatic(w, 0.06, d, mat), 0, h - 0.03, 0);
      feet(w, d, 0.05, h - 0.06, dark, add);
      break;
    }
    case 'chair': {
      add(prismatic(w * 0.9, 0.05, d * 0.9, mat), 0, h * 0.5, 0);
      add(prismatic(w * 0.9, h * 0.45, 0.06, mat), 0, h, -d * 0.35);
      feet(w * 0.7, d * 0.7, 0.035, h * 0.5, dark, add);
      break;
    }
    case 'stool': {
      add(prismatic(w * 0.9, 0.06, d * 0.9, mat), 0, h * 0.55, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, h * 0.5, 10), dark), 0, h * 0.27, 0);
      break;
    }
    case 'bench': {
      add(prismatic(w, 0.06, d, mat), 0, h * 0.55, 0);
      add(prismatic(w, h * 0.42, 0.05, mat), 0, h, -d / 2 + 0.03);
      feet(w, d, 0.04, h * 0.55, dark, add);
      break;
    }
    case 'bed': {
      add(prismatic(w, 0.16, d, dark), 0, 0.16, 0);
      add(prismatic(w, 0.28, d, mat), 0, 0.38, 0);
      add(prismatic(w, 0.12, 0.12, light), w * 0.25, 0.48, -d / 2 + 0.1);
      add(prismatic(w * 0.5, 0.14, 0.1, light), w * 0.25, 0.48, d / 2 - 0.08);
      add(prismatic(0.1, h - 0.35, d, dark), -w / 2 + 0.05, (h - 0.35) / 2, 0);
      break;
    }
    case 'wardrobe': {
      add(prismatic(w, h, d, mat), 0, h / 2, 0);
      add(prismatic(w - 0.04, h * 0.95, 0.015, light), w / 4 - 0.5, h * 0.52, d / 2 + 0.001);
      add(prismatic(w - 0.04, h * 0.95, 0.015, light), -w / 4 - 0.5, h * 0.52, d / 2 + 0.001);
      break;
    }
    case 'nightstand': {
      add(prismatic(w, h, d, mat), 0, h / 2, 0);
      feet(w - 0.04, d - 0.04, 0.06, 0.06, dark, add);
      break;
    }
    case 'dresser': {
      add(prismatic(w, h, d, dark), 0, h / 2, 0);
      [0.15, 0.35, 0.55, 0.75].forEach((y) => add(prismatic(w - 0.06, 0.02, 0.1, light), 0, h * y, d / 2 + 0.002));
      break;
    }
    case 'desk': {
      add(prismatic(w, 0.05, d, mat), 0, h - 0.025, 0);
      add(prismatic(0.06, h * 0.7, d - 0.1, dark), -w / 2 + 0.03, h * 0.35, 0);
      add(prismatic(0.06, h * 0.7, d - 0.1, dark), w / 2 - 0.03, h * 0.35, 0);
      break;
    }
    case 'office-chair': {
      add(prismatic(w * 0.9, 0.08, d * 0.9, dark), 0, h * 0.55, 0);
      add(prismatic(w * 0.9, h * 0.4, 0.07, dark), 0, h * 0.92, -d * 0.32);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, h * 0.45, 10), pool.mat('#22252a', 0.4, 0.8)), 0, h * 0.28, 0);
      add(prismatic(w * 0.9, 0.04, d * 0.9, dark), 0, 0.05, 0);
      break;
    }
    case 'floor-lamp': {
      add(prismatic(0.18, 0.02, 0.18, dark), 0, 0.02, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, h * 0.75, 10), pool.mat('#3a3d42', 0.5, 0.6)), 0, h * 0.4, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.09, 0.22, 20), pool.mat(color, 0.9, 0.1, app.opacity)), 0, h, 0);
      break;
    }
    case 'table-lamp': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.03, 16), dark), 0, 0.03, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), mat), 0, h * 0.45, 0);
      break;
    }
    case 'pendant': {
      // Hangs from the ceiling: `h` is the ceiling, the shade drops below it.
      // Older projects stored the shade's own height here, so keep a sane
      // minimum rather than burying the lamp in the floor.
      const ceiling = Math.max(h, 1.6);
      const shade = ceiling - 0.55;
      add(prismatic(0.02, 0.55, 0.02, pool.mat('#3a3d42', 0.4, 0.6)), 0, shade, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.18, 0.22, 24), mat), 0, shade - 0.22, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), pool.mat('#fff3c4', 0.2, 0)), 0, shade - 0.26, 0);
      break;
    }
    case 'plant': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.28, w * 0.22, h * 0.18, 12), pool.mat('#8a5a3b', 0.7, 0.05)), 0, h * 0.09, 0);
      const foliage = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w * 0.5, h * 0.32), 12, 10), pool.mat('#3f7d4c', 0.9, 0));
      add(foliage, 0, h * 0.48, 0);
      break;
    }
    case 'rug': {
      const rug = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), mat);
      rug.receiveShadow = true;
      add(rug, 0, 0.012, 0);
      break;
    }
    case 'bathtub': {
      add(prismatic(w, h * 0.75, d, mat), 0, h * 0.37, 0);
      add(prismatic(w - 0.08, h * 0.55, d - 0.08, pool.mat('#8fb0bf', 0.15, 0.05)), 0, h * 0.42, 0.01);
      break;
    }
    case 'toilet': {
      add(prismatic(0.4, 0.25, 0.28, mat), 0, h * 0.45, 0.12);
      add(prismatic(0.32, h * 0.52, 0.14, mat), 0, h * 0.26, -0.22);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 20), mat), 0, 0.1, -0.05);
      break;
    }
    case 'sink': {
      add(prismatic(0.3, 0.14, 0.22, mat), 0, h - 0.07, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.12, 20), mat), 0, 0.08, 0);
      break;
    }
    case 'shower': {
      add(prismatic(w, 0.05, d, pool.mat('#aab4bb', 0.4, 0.1)), 0, 0.03, 0);
      add(prismatic(0.04, h * 0.9, d, pool.mat('#9fc4d4', 0.1, 0.1)), -w / 2, h * 0.45, 0);
      add(prismatic(w, h * 0.9, 0.04, pool.mat('#9fc4d4', 0.1, 0.1)), 0, h * 0.45, -d / 2);
      const d2 = d * 0.6;
      add(prismatic(0.04, h * 0.5, d2, pool.mat('#9fc4d4', 0.1, 0.1)), w / 2, h * 0.25, -d2 / 2 + d2 / 2 - 0.02);
      break;
    }
    case 'oven': {
      add(prismatic(w, h, d, pool.mat('#33363b', 0.4, 0.2)), 0, h / 2, 0);
      add(prismatic(w - 0.06, h * 0.6, 0.02, pool.mat('#0d1117', 0.2, 0.3)), 0, h * 0.48, d / 2 + 0.006);
      break;
    }
    case 'refrigerator': {
      add(prismatic(w, h, d, pool.mat('#c9ccd1', 0.35, 0.15)), 0, h / 2, 0);
      add(prismatic(w - 0.04, 0.03, d - 0.02, pool.mat('#8a8d91', 0.4, 0.2)), 0, h * 0.52, d / 2 + 0.002);
      add(prismatic(w - 0.04, 0.03, d - 0.02, pool.mat('#8a8d91', 0.4, 0.2)), 0, h * 0.24, d / 2 + 0.002);
      break;
    }
    case 'kitchen-island': {
      add(prismatic(w, h * 0.5, d, mat), 0, h * 0.56, 0);
      add(prismatic(w * 0.5, 0.04, d * 0.6, pool.mat('#f4f1ea', 0.5, 0.05)), -w * 0.13, h - 0.02, 0);
      break;
    }
    case 'recliner': {
      add(prismatic(w, h * 0.34, d * 0.8, mat), 0, 0, d * 0.1);
      add(prismatic(0.14, h * 0.55, d * 0.8, dark), -(w / 2 - 0.07), h * 0.28, d * 0.1);
      add(prismatic(0.14, h * 0.55, d * 0.8, dark), w / 2 - 0.07, h * 0.28, d * 0.1);
      add(prismatic(w, h * 0.78, 0.16, dark), 0, h * 0.35, -d / 2 + 0.08);
      // The footrest is what makes a recliner read as one from across a room.
      add(prismatic(w * 0.8, h * 0.16, d * 0.28, light), 0, h * 0.18, d / 2 - 0.1);
      break;
    }
    case 'tv': {
      // Wall-mounted: `h` is the height of the top of the screen.
      const screenH = Math.min(h * 0.48, 0.74);
      const centre = h - screenH / 2;
      add(prismatic(w, screenH, 0.05, pool.mat('#15181d', 0.35, 0.3)), 0, centre - screenH / 2, 0);
      add(prismatic(w - 0.04, screenH - 0.04, 0.012, pool.mat('#0b0e13', 0.12, 0.5)), 0, centre - screenH / 2 + 0.02, 0.03);
      // Bracket back to the wall, so it does not look like it floats.
      add(prismatic(0.18, 0.18, 0.06, dark), 0, centre - 0.09, -0.05);
      break;
    }
    case 'bunk-bed': {
      const post = 0.08;
      const lower = h * 0.24;
      const upper = h * 0.78;
      for (const [px, pz] of [
        [-w / 2 + post / 2, -d / 2 + post / 2],
        [w / 2 - post / 2, -d / 2 + post / 2],
        [-w / 2 + post / 2, d / 2 - post / 2],
        [w / 2 - post / 2, d / 2 - post / 2],
      ] as [number, number][]) {
        add(prismatic(post, h, post, dark), px, 0, pz);
      }
      for (const y of [lower, upper]) {
        add(prismatic(w, 0.1, d, dark), 0, y, 0);
        add(prismatic(w - 0.08, 0.16, d - 0.08, light), 0, y + 0.1, 0);
        add(prismatic(w - 0.1, 0.1, 0.24, mat), 0, y + 0.26, -d / 2 + 0.16);
      }
      // Guard rail on the top bunk + ladder.
      add(prismatic(w * 0.7, 0.06, 0.05, dark), 0, upper + 0.4, d / 2 - 0.06);
      for (let i = 0; i < 4; i++) add(prismatic(0.3, 0.05, 0.05, dark), w / 2 - 0.16, lower + 0.2 + i * 0.32, d / 2 - 0.02);
      break;
    }
    case 'crib': {
      add(prismatic(w, 0.1, d, dark), 0, h * 0.34, 0);
      add(prismatic(w - 0.08, 0.12, d - 0.08, light), 0, h * 0.44, 0);
      // Slatted sides.
      const slats = 7;
      for (let i = 0; i < slats; i++) {
        const t = -d / 2 + 0.06 + (i * (d - 0.12)) / (slats - 1);
        add(prismatic(0.04, h * 0.5, 0.04, mat), -w / 2 + 0.03, h * 0.5, t);
        add(prismatic(0.04, h * 0.5, 0.04, mat), w / 2 - 0.03, h * 0.5, t);
      }
      add(prismatic(w, 0.05, 0.05, mat), 0, h, -d / 2 + 0.03);
      add(prismatic(w, 0.05, 0.05, mat), 0, h, d / 2 - 0.03);
      break;
    }
    case 'dressing-table': {
      const deck = 0.75;
      add(prismatic(w, 0.05, d, mat), 0, deck - 0.025, 0);
      add(prismatic(w * 0.45, deck - 0.05, d - 0.04, dark), -w * 0.26, 0, 0);
      [0.2, 0.42, 0.62].forEach((f) => add(prismatic(w * 0.4, 0.02, 0.02, light), -w * 0.26, deck * f, d / 2));
      add(prismatic(w * 0.06, deck - 0.05, d - 0.04, dark), w / 2 - w * 0.03, 0, 0);
      // Mirror above the deck.
      add(prismatic(w * 0.62, h - deck - 0.06, 0.04, dark), 0, deck, -d / 2 + 0.06);
      add(prismatic(w * 0.54, h - deck - 0.16, 0.012, pool.mat('#cfe0e8', 0.08, 0.6)), 0, deck + 0.05, -d / 2 + 0.09);
      break;
    }
    case 'ceiling-fan': {
      // Ceiling-mounted: `h` is the ceiling height it hangs from.
      const hub = h - 0.28;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 10), dark), 0, h - 0.13, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 18), mat), 0, hub, 0);
      for (let i = 0; i < 3; i++) {
        const angle = (i * Math.PI * 2) / 3;
        const blade = prismatic(w * 0.45, 0.02, 0.16, mat);
        blade.position.set(Math.cos(angle) * w * 0.24, hub - 0.03, Math.sin(angle) * w * 0.24);
        blade.rotation.y = -angle;
        blade.castShadow = true;
        group.add(blade);
      }
      add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), pool.mat('#fff3c4', 0.2, 0)), 0, hub - 0.12, 0);
      break;
    }
    case 'mirror': {
      // Wall-mounted: `h` is the top edge.
      const panelH = Math.min(h * 0.75, 1.2);
      const bottom = h - panelH;
      add(prismatic(w, panelH, 0.04, dark), 0, bottom, 0);
      add(prismatic(w - 0.07, panelH - 0.07, 0.015, pool.mat('#cfe0e8', 0.06, 0.75)), 0, bottom + 0.035, 0.02);
      break;
    }
    case 'water-heater': {
      // Wall-mounted geyser: a horizontal tank just below `h`.
      const r = Math.min(w, d) / 2;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(w, 0.35), 20), mat);
      tank.rotation.z = Math.PI / 2;
      add(tank, 0, h - r, 0);
      add(prismatic(0.1, 0.16, 0.06, dark), 0, h - r * 2 - 0.08, 0);
      break;
    }
    case 'microwave': {
      add(prismatic(w, h, d, pool.mat('#33363b', 0.4, 0.25)), 0, 0, 0);
      add(prismatic(w * 0.66, h - 0.06, 0.015, pool.mat('#12151a', 0.15, 0.4)), -w * 0.14, 0.03, d / 2 + 0.004);
      add(prismatic(w * 0.2, h - 0.08, 0.012, dark), w * 0.35, 0.04, d / 2 + 0.004);
      break;
    }
    case 'kitchen-sink': {
      add(prismatic(w, h - 0.06, d, mat), 0, 0, 0);
      add(prismatic(w, 0.06, d, pool.mat('#e9ecef', 0.35, 0.1)), 0, h - 0.06, 0);
      // Steel basin + mixer tap.
      const steel = pool.mat('#aeb6bd', 0.25, 0.75);
      add(prismatic(w * 0.55, 0.05, d * 0.6, steel), -w * 0.12, h - 0.075, 0.02);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 10), steel), -w * 0.12, h + 0.12, -d * 0.3);
      add(prismatic(0.02, 0.02, 0.16, steel), -w * 0.12, h + 0.26, -d * 0.22);
      break;
    }
    case 'hood': {
      // Chimney hood over a hob: `h` is where the duct meets the ceiling.
      const steel = pool.mat('#aeb6bd', 0.3, 0.7);
      const canopyTop = 1.85;
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(w, d) * 0.42, Math.max(w, d) * 0.2, 0.26, 4), steel);
      canopy.rotation.y = Math.PI / 4;
      add(canopy, 0, canopyTop - 0.13, 0);
      add(prismatic(w * 0.32, Math.max(h - canopyTop, 0.1), d * 0.32, steel), 0, canopyTop, 0);
      add(prismatic(w * 0.9, 0.03, d * 0.75, pool.mat('#2b2f35', 0.4, 0.3)), 0, canopyTop - 0.27, 0);
      break;
    }
    case 'washing-machine': {
      add(prismatic(w, h, d, mat), 0, 0, 0);
      // Front-loader door + detergent drawer + control strip.
      const glass = pool.mat('#7f9aa8', 0.15, 0.2, 0.75);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.3, 0.05, 24), dark);
      ring.rotation.x = Math.PI / 2;
      add(ring, 0, h * 0.45, d / 2 + 0.01);
      const port = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.22, w * 0.22, 0.04, 24), glass);
      port.rotation.x = Math.PI / 2;
      add(port, 0, h * 0.45, d / 2 + 0.03);
      add(prismatic(w * 0.86, 0.09, 0.02, dark), 0, h * 0.86, d / 2 + 0.005);
      add(prismatic(w * 0.3, 0.06, 0.02, light), -w * 0.26, h * 0.78, d / 2 + 0.005);
      break;
    }
    case 'dishwasher': {
      add(prismatic(w, h, d, mat), 0, 0, 0);
      add(prismatic(w - 0.04, h * 0.82, 0.02, pool.mat('#9aa1a9', 0.3, 0.6)), 0, 0.02, d / 2 + 0.006);
      add(prismatic(w - 0.1, 0.04, 0.05, pool.mat('#8b939b', 0.3, 0.7)), 0, h * 0.88, d / 2 + 0.02);
      break;
    }
    case 'shoe-rack': {
      add(prismatic(w, 0.04, d, mat), 0, h - 0.04, 0);
      add(prismatic(0.05, h, d, mat), -w / 2 + 0.025, 0, 0);
      add(prismatic(0.05, h, d, mat), w / 2 - 0.025, 0, 0);
      // Tilted open shelves, the way a shoe rack actually holds shoes.
      for (let i = 0; i < 3; i++) {
        const shelf = prismatic(w - 0.1, 0.03, d * 0.86, light);
        shelf.position.set(0, 0.16 + i * (h - 0.28) / 3, 0);
        shelf.rotation.x = -0.28;
        shelf.castShadow = true;
        group.add(shelf);
      }
      break;
    }
    case 'pooja-unit': {
      add(prismatic(w, h * 0.42, d, mat), 0, 0, 0);
      add(prismatic(w * 0.94, h * 0.4, d * 0.9, light), 0, h * 0.44, 0);
      add(prismatic(w, 0.05, d, dark), 0, h * 0.84, 0);
      // Arched crown.
      const dome = new THREE.Mesh(new THREE.SphereGeometry(w * 0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), pool.mat(tint(color, 0.15), 0.5, 0.35));
      add(dome, 0, h * 0.89, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), dark), 0, h - 0.06, 0);
      break;
    }
    case 'curtain': {
      // Wall-mounted: `h` is the rail height; the drop hangs from it.
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, w + 0.14, 10), dark);
      rail.rotation.z = Math.PI / 2;
      add(rail, 0, h, 0);
      const drop = h - 0.06;
      const pleats = 8;
      for (let i = 0; i < pleats; i++) {
        const half = i < pleats / 2 ? -1 : 1;
        const spread = (i % (pleats / 2)) / (pleats / 2 - 1);
        const x = half * (w * 0.5 - spread * w * 0.2);
        const panel = prismatic(w * 0.13, drop, d * 0.7, i % 2 ? light : mat);
        panel.position.set(x, drop / 2, 0);
        panel.castShadow = true;
        group.add(panel);
      }
      break;
    }
    case 'ac-split': {
      // Wall-mounted indoor unit: `h` is the top of the casing.
      const bodyH = Math.min(h * 0.14, 0.32);
      add(prismatic(w, bodyH, d, mat), 0, h - bodyH, 0);
      add(prismatic(w * 0.9, 0.05, 0.03, dark), 0, h - bodyH + 0.03, d / 2 + 0.005);
      add(prismatic(w * 0.2, 0.02, 0.02, pool.mat('#5ec8f0', 0.3, 0.2)), w * 0.32, h - 0.06, d / 2 + 0.005);
      break;
    }
    case 'stairs': {
      // `h` is the total rise. The bottom step is at the front (+z) and the
      // flight climbs towards the back, which is also the ramp the
      // walkthrough's ground detection follows (see StairController).
      const { steps, run, riser } = stairProfile(d, h);
      for (let i = 0; i < steps; i++) {
        const top = (i + 1) * riser;
        const zc = d / 2 - (i + 0.5) * run;
        const tread = prismatic(w, top, run, i % 2 ? mat : light);
        tread.receiveShadow = true;
        add(tread, 0, top / 2, zc);
      }
      // Handrail on the right-hand side going up.
      const railLen = Math.hypot(d, h);
      const tilt = Math.atan2(h, d);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, railLen, 10), dark);
      rail.rotation.set(Math.PI / 2 + tilt, 0, 0);
      add(rail, w / 2 - 0.04, h / 2 + 0.9, 0);
      for (const t of [0.08, 0.5, 0.92]) {
        const post = prismatic(0.03, 0.9, 0.03, dark);
        add(post, w / 2 - 0.04, t * h + 0.45, d / 2 - t * d);
      }
      break;
    }
    case 'elevator': {
      // A cabin open at the front (+z) with two sliding door panels the
      // walkthrough animates. Walls are thin so the car stays walkable inside.
      const steel = pool.mat('#aeb6bd', 0.3, 0.7);
      const wallT = 0.05;
      add(prismatic(w, 0.04, d, dark), 0, 0.02, 0);
      add(prismatic(w, h, wallT, mat), 0, h / 2, -d / 2 + wallT / 2);
      add(prismatic(wallT, h, d, mat), -w / 2 + wallT / 2, h / 2, 0);
      add(prismatic(wallT, h, d, mat), w / 2 - wallT / 2, h / 2, 0);
      add(prismatic(w, 0.05, d, light), 0, h - 0.025, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), pool.mat('#fff3c4', 0.2, 0)), 0, h - 0.1, 0);
      // Front frame above the doors and the two panels.
      add(prismatic(w, 0.12, 0.06, steel), 0, h - 0.06, d / 2 - 0.03);
      const panelW = w / 2 - 0.02;
      for (const side of [-1, 1] as const) {
        const panel = prismatic(panelW, h - 0.14, 0.04, steel);
        panel.userData.doorPart = 'elevatorDoor';
        panel.userData.elevatorSlide = { closedX: (side * w) / 4, dir: side, travel: panelW * 0.92 };
        add(panel, (side * w) / 4, (h - 0.14) / 2, d / 2 - 0.02);
      }
      // Call panel next to the doors.
      add(prismatic(0.08, 0.14, 0.02, dark), w / 2 - 0.1, 1.1, d / 2 + 0.01);
      break;
    }
    default: {
      add(prismatic(w, h, d, mat), 0, h / 2, 0);
    }
  }

  // Orientation and scale are applied by `placeFurniture`.
  return group;
}

/**
 * Step count for a flight: as many risers as it takes to keep each one near
 * 17.5 cm, the comfortable domestic value. Shared by the mesh builder and the
 * walkthrough so the feet land where the eye sees a tread.
 */
export function stairProfile(depth: number, rise: number): { steps: number; run: number; riser: number } {
  const steps = Math.max(2, Math.round(rise / 0.175));
  return { steps, run: depth / steps, riser: rise / steps };
}

/** Slides an elevator door panel: 0 = closed, 1 = fully open. */
export function poseElevatorDoor(panel: THREE.Object3D, open: number): void {
  const s = panel.userData.elevatorSlide as { closedX: number; dir: number; travel: number } | undefined;
  if (!s) return;
  panel.position.x = s.closedX + s.dir * s.travel * Math.min(Math.max(open, 0), 1);
}

/**
 * Applies the model transform to a furniture group. Position is local to the
 * floor group (which carries the elevation), so Y stays at 0 — the model has
 * no vertical coordinate for objects.
 */
export function placeFurniture(mesh: THREE.Object3D, obj: ProjectObject): void {
  mesh.position.set(obj.x, 0, obj.z);
  mesh.rotation.set(0, obj.rotation, 0);
  mesh.scale.setScalar(obj.scale);
}

function prismatic(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.y = h / 2;
  return mesh;
}

function feet(w: number, d: number, size: number, h: number, mat: THREE.Material, add: (m: THREE.Mesh, x: number, y: number, z: number) => void) {
  const positions: [number, number][] = [
    [-w / 2 + size, -d / 2 + size],
    [w / 2 - size, -d / 2 + size],
    [-w / 2 + size, d / 2 - size],
    [w / 2 - size, d / 2 - size],
  ];
  for (const [x, z] of positions) add(prismatic(size, h, size, mat), x, h / 2, z);
}

function shade(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(Math.round(r * (1 - amt)), Math.round(g * (1 - amt)), Math.round(b * (1 - amt)));
}

function tint(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(Math.round(r + (255 - r) * amt), Math.round(g + (255 - g) * amt), Math.round(b + (255 - b) * amt));
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// --- lighting presets --------------------------------------------------------

export const LIGHT_PRESETS = {
  daylight: { intensity: 2.4, color: '#fff5e6', ambient: 0.55, bg: '#11151c' },
  evening: { intensity: 1.1, color: '#c9a86a', ambient: 0.35, bg: '#0c1016' },
  warm: { intensity: 1.6, color: '#ffcb8a', ambient: 0.45, bg: '#151014' },
  studio: { intensity: 3.0, color: '#ffffff', ambient: 0.7, bg: '#0e1320' },
  // Moonlight: the walkthrough's room lights do the work at night.
  night: { intensity: 0.18, color: '#8fa3c7', ambient: 0.14, bg: '#04060a' },
} as const;

export type LightPreset = keyof typeof LIGHT_PRESETS;
