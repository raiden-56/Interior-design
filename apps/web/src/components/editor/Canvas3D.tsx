'use client';

import * as React from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, TransformControls, Grid } from '@react-three/drei';
import { useEditorStore } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';
import {
  buildScene,
  disposeScene,
  structureSignature,
  syncInstancedPlant,
  tagObject,
  type InstancedBatch,
} from '@/lib/three/scene';
import { MeshPool, LIGHT_PRESETS, buildFurnitureMesh, placeFurniture, appearanceKey } from '@/lib/three/meshes';
import { registerCapturer } from '@/lib/capture';

export function Canvas3D() {
  const renderPreset = useUiStore((s) => s.renderPreset);
  const preset = LIGHT_PRESETS[renderPreset];

  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, 1.5]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ fov: 50, near: 0.1, far: 2000, position: [8, 7, 10] }}
    >
      <color attach="background" args={[preset.bg]} />
      <ambientLight intensity={preset.ambient} color="#ffffff" />
      <hemisphereLight args={['#ffffff', '#3a4150', 0.5]} />
      <directionalLight
        position={[12, 18, 8]}
        intensity={preset.intensity}
        color={preset.color}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-8, 6, -6]} intensity={preset.intensity * 0.28} color="#b8c4d6" />
      <EditorRig />
    </Canvas>
  );
}

interface Session {
  group: THREE.Group;
  entities: Map<string, THREE.Object3D>;
  pool: MeshPool;
  instanced: InstancedBatch | null;
}

/** Pointer travel (px) above which a press counts as a drag, not a click. */
const CLICK_SLOP = 4;

function EditorRig() {
  const { scene, camera, gl, invalidate, controls } = useThree();
  const sessionRef = React.useRef<Session | null>(null);
  const [selObject, setSelObject] = React.useState<THREE.Object3D | null>(null);
  const [selKind, setSelKind] = React.useState<string | null>(null);
  const controlsRef = React.useRef<any>(null);
  const tcRef = React.useRef<any>(null);
  const isTransforming = React.useRef(false);
  /**
   * Stays true for one frame after a gizmo drag ends. The gizmo and the picker
   * both listen on the same canvas element, and the gizmo clears its own
   * `dragging` flag during pointerup — without this latch, a press that ends
   * on a gizmo handle falls through to the picker and clears the selection.
   */
  const gizmoRecent = React.useRef(false);
  const pointerStart = React.useRef<{ x: number; y: number } | null>(null);
  const transformInit = React.useRef<{ px: number; pz: number; ry: number; sx: number } | null>(null);
  const commitTransformRef = React.useRef<() => void>(() => {});

  const project = useEditorStore((s) => s.project);
  const activeFloorId = useEditorStore((s) => s.activeFloorId);
  const selection = useEditorStore((s) => s.selection);
  // Read reactively. Reaching for `getState().tool` meant switching back to
  // the select tool did not re-render, so the gizmo stayed hidden until some
  // unrelated change happened to trigger one.
  const tool = useEditorStore((s) => s.tool);
  const renderPreset = useUiStore((s) => s.renderPreset);
  const cameraPreset = useUiStore((s) => s.cameraPreset);
  const cameraNonce = useUiStore((s) => s.cameraNonce);
  const transformMode = useUiStore((s) => s.transformMode);
  const spaceHeld = useUiStore((s) => s.spaceHeld);
  /**
   * Left-drag pans instead of orbiting while Space is held or the Hand tool is
   * active — the same gesture as the floor plan, so switching views does not
   * change how you move around.
   */
  const panMode = spaceHeld || tool === 'pan';

  /**
   * Only geometry-affecting model state. Object transforms, colours and
   * materials are excluded and applied in place below. Keying the rebuild on
   * `project.updatedAt` meant every commit and every slider tick destroyed
   * and recreated the very object the gizmo was attached to.
   */
  const structureKey = React.useMemo(() => structureSignature(project), [project]);

  // --- build / rebuild scene (structural changes only) -----------------------
  React.useEffect(() => {
    if (!sessionRef.current) {
      sessionRef.current = { group: new THREE.Group(), entities: new Map(), pool: new MeshPool(), instanced: null };
    }
    const session = sessionRef.current;
    scene.remove(session.group);
    disposeScene(session.group, session.pool);

    // Read the model here rather than closing over it, so this effect stays
    // keyed purely on the structural signature.
    const current = useEditorStore.getState().project;
    const built = buildScene(session.pool, current, activeFloorId);
    session.group = built.group;
    session.entities = built.entities;
    session.instanced = built.instanced;
    scene.add(session.group);
    invalidate();
  }, [scene, structureKey, activeFloorId, invalidate]);

  // Release pooled materials when the canvas goes away.
  React.useEffect(() => {
    return () => {
      const session = sessionRef.current;
      if (!session) return;
      scene.remove(session.group);
      disposeScene(session.group, session.pool);
      session.pool.disposeAll();
      sessionRef.current = null;
    };
  }, [scene]);

  // --- in-place object sync (transform + appearance) -------------------------
  React.useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    let dirty = false;

    for (const floor of project.floors) {
      if (!floor.visible) continue;
      for (const obj of floor.objects) {
        // Batched plants live in an instanced buffer, not the scene graph.
        if (session.instanced?.index.has(obj.id)) {
          if (syncInstancedPlant(session.instanced, obj, floor.elevation)) dirty = true;
          continue;
        }

        const node = session.entities.get(obj.id);
        if (!node) continue;

        const key = appearanceKey(obj.materialId, obj.color);
        if (node.userData.appearanceKey !== key) {
          // Colour or material changed: rebuild just this one group, in place.
          const parent = node.parent;
          if (!parent) continue;
          const next = buildFurnitureMesh(session.pool, obj);
          tagObject(next, obj);
          placeFurniture(next, obj);
          parent.add(next);
          parent.remove(node);
          disposeScene(node, session.pool);
          session.entities.set(obj.id, next);
          if (selObject === node) setSelObject(next);
          dirty = true;
          continue;
        }

        // Transform only — cheap, and leaves the gizmo attached to its target.
        if (
          node.position.x !== obj.x ||
          node.position.z !== obj.z ||
          node.rotation.y !== obj.rotation ||
          node.scale.x !== obj.scale
        ) {
          placeFurniture(node, obj);
          dirty = true;
        }
      }
    }

    if (dirty) invalidate();
    // `selObject` is read only to re-point the gizmo at a replaced node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, invalidate]);

  // --- background per preset -------------------------------------------------
  React.useEffect(() => {
    scene.background = new THREE.Color(LIGHT_PRESETS[renderPreset].bg);
    invalidate();
  }, [renderPreset, scene, invalidate]);

  // --- selection -> gizmo target ---------------------------------------------
  React.useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (selection.length !== 1) {
      setSelObject(null);
      setSelKind(null);
      return;
    }
    const id = selection[0];
    const kind = kindOfId(id);
    if (!kind) {
      setSelObject(null);
      setSelKind(null);
      return;
    }

    const direct = session.entities.get(id);
    if (direct) {
      setSelObject(direct);
      setSelKind(kind);
      return;
    }

    // Fall back to a tree scan (ids can arrive from the 2D editor before the
    // matching entity is registered). A miss is deliberately NOT cached:
    // storing a placeholder Object3D here left the gizmo permanently bound to
    // an empty node that could never be moved.
    const found = findEntityByTree(session.group, kind, id);
    if (found) session.entities.set(id, found);
    setSelObject(found);
    setSelKind(found ? kind : null);
  }, [selection, structureKey, activeFloorId]);

  // --- picking ---------------------------------------------------------------
  React.useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const toNdc = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
    };

    const onDown = (e: PointerEvent) => {
      pointerStart.current = { x: e.clientX, y: e.clientY };
    };

    /**
     * Selection resolves on pointer *up*, not down.
     *
     * On pointerdown this raycast only ever tested the model group, so a press
     * on a transform-gizmo handle (which is not in that group) hit nothing and
     * cleared the selection — unmounting the gizmo the instant a drag started,
     * which is why objects could not be dragged at all. Deciding on pointerup,
     * and only when the pointer barely moved, additionally stops an orbit drag
     * across empty space from wiping the selection.
     */
    const onUp = (e: PointerEvent) => {
      const start = pointerStart.current;
      pointerStart.current = null;
      const session = sessionRef.current;
      if (!start || !session) return;

      if (isTransforming.current || gizmoRecent.current || tcRef.current?.dragging) return;
      // A click that only moved the camera must not change the selection.
      if (useUiStore.getState().spaceHeld || useEditorStore.getState().tool === 'pan') return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP) return;

      toNdc(e);

      // Placing furniture from the catalog.
      const pending = useUiStore.getState().pendingAsset;
      if (pending) {
        const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hit = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(ground, hit)) {
          const id = 'obj-' + Math.random().toString(36).slice(2, 9);
          useEditorStore.getState().run({
            type: 'ADD_OBJECT',
            object: {
              id,
              assetId: pending.assetId,
              name: pending.name,
              shape: pending.shape,
              x: round2(hit.x),
              z: round2(hit.z),
              rotation: 0,
              scale: 1,
              width: pending.width,
              depth: pending.depth,
              height: pending.height,
              color: pending.color,
              materialId: null,
              ...(pending.mounted ? { metadata: { mounted: true } } : {}),
            },
          });
          useUiStore.getState().setPendingAsset(null);
          useEditorStore.getState().select([id]);
          invalidate();
        }
        return;
      }

      const hits = raycaster.intersectObject(session.group, true);
      for (const hit of hits) {
        const entity = resolveHit(hit);
        if (entity) {
          useEditorStore.getState().select([entity.id]);
          invalidate();
          return;
        }
      }
      useEditorStore.getState().select([]);
      invalidate();
    };

    const onMove = (e: PointerEvent) => {
      if (isTransforming.current) return;
      const session = sessionRef.current;
      if (!session) return;
      toNdc(e);
      const hits = raycaster.intersectObject(session.group, true);
      const over = hits.some((h) => resolveHit(h) !== null);
      const activeTool = useEditorStore.getState().tool;
      if (useUiStore.getState().spaceHeld || activeTool === 'pan') {
        gl.domElement.style.cursor = 'grab';
        return;
      }
      gl.domElement.style.cursor = activeTool !== 'select' ? '' : over ? 'pointer' : 'grab';
    };

    gl.domElement.addEventListener('pointerdown', onDown);
    gl.domElement.addEventListener('pointerup', onUp);
    gl.domElement.addEventListener('pointermove', onMove);
    return () => {
      gl.domElement.removeEventListener('pointerdown', onDown);
      gl.domElement.removeEventListener('pointerup', onUp);
      gl.domElement.removeEventListener('pointermove', onMove);
    };
  }, [camera, gl, invalidate]);

  // Space produces no pointer event, so the hand cursor needs its own effect.
  React.useEffect(() => {
    gl.domElement.style.cursor = panMode ? 'grab' : '';
  }, [panMode, gl]);

  // --- camera presets --------------------------------------------------------
  React.useEffect(() => {
    const target = sceneBounds(useEditorStore.getState().project, activeFloorId);
    if (cameraPreset === 'persp') {
      // Initial mount is framed by the effect below; a later click on the
      // perspective button (or the Fit button / F key) re-frames the scene.
      if (cameraNonce === 0) return;
      camera.position.set(target.cx + target.span * 1.1, target.mid + target.span * 0.9, target.cz + target.span * 1.1);
      camLookAt(camera, controls, new THREE.Vector3(target.cx, target.mid, target.cz));
      invalidate();
      return;
    }
    const distance = Math.max(target.span, 4) * 1.35;
    const mid = (target.y0 + target.y1) / 2;
    let pos: THREE.Vector3;
    if (cameraPreset === 'top') {
      pos = new THREE.Vector3(target.cx, target.y1 + distance, target.cz + 0.001);
    } else if (cameraPreset === 'iso') {
      pos = new THREE.Vector3(target.cx + distance, mid + distance * 0.85, target.cz + distance);
    } else {
      pos = new THREE.Vector3(target.cx, mid + 1.5, target.cz - distance);
    }
    camera.position.copy(pos);
    camLookAt(camera, controls, new THREE.Vector3(target.cx, mid, target.cz));
    invalidate();
    // Framing follows the view buttons, not every model edit — depending on
    // `project` here yanked the camera back mid-edit.
  }, [cameraPreset, cameraNonce, activeFloorId, camera, controls, invalidate]);

  // --- initial framing once ----------------------------------------------------
  const didFrame = React.useRef(false);
  React.useEffect(() => {
    if (didFrame.current) return;
    didFrame.current = true;
    const target = sceneBounds(project, activeFloorId);
    camera.position.set(target.cx + target.span * 1.1, target.mid + target.span * 0.9, target.cz + target.span * 1.1);
    camLookAt(camera, controls, new THREE.Vector3(target.cx, target.mid, target.cz));
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 3D snapshot -------------------------------------------------------------
  React.useEffect(() => {
    registerCapturer(async () => {
      invalidate();
      await new Promise((r) => requestAnimationFrame(r));
      const url = gl.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(project.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-preview.png`;
      a.click();
    });
    return () => registerCapturer(null);
  }, [gl, invalidate, project.name]);

  const commitTransform = React.useCallback(() => {
    const obj = selObject;
    const init = transformInit.current;
    transformInit.current = null;
    if (selKind !== 'object' || !obj || !init) return;

    const id = selId(obj);
    if (!id) return;

    const moved = Math.abs(obj.position.x - init.px) > 0.001 || Math.abs(obj.position.z - init.pz) > 0.001;
    const rotated = Math.abs(obj.rotation.y - init.ry) > 0.001;
    const scaled = Math.abs(obj.scale.x - init.sx) > 0.001;
    if (!moved && !rotated && !scaled) return;

    useEditorStore.getState().run({
      type: 'UPDATE_OBJECT',
      id,
      patch: {
        x: round2(obj.position.x),
        z: round2(obj.position.z),
        rotation: round3(obj.rotation.y),
        scale: round2(obj.scale.x),
      },
    });
    invalidate();
  }, [selKind, selObject, invalidate]);

  commitTransformRef.current = commitTransform;

  /**
   * Keeps the gizmo's degrees of freedom in step with what the model can
   * store: a floor-plane position, one Y rotation, one uniform scale. Without
   * this the gizmo would happily lift an object off the floor or squash a
   * single axis, and the change silently vanished on release.
   */
  const constrainToModel = React.useCallback(() => {
    const obj = selObject;
    if (!obj) return;
    if (transformMode === 'translate') {
      obj.position.y = 0;
    } else if (transformMode === 'rotate') {
      obj.rotation.x = 0;
      obj.rotation.z = 0;
    } else {
      const base = transformInit.current?.sx ?? 1;
      const dx = Math.abs(obj.scale.x - base);
      const dy = Math.abs(obj.scale.y - base);
      const dz = Math.abs(obj.scale.z - base);
      const dragged = dx >= dy && dx >= dz ? obj.scale.x : dy >= dz ? obj.scale.y : obj.scale.z;
      obj.scale.setScalar(clamp(dragged, 0.2, 4));
    }
    invalidate();
  }, [selObject, transformMode, invalidate]);

  const showGizmo = selKind === 'object' && selObject != null && selection.length === 1 && tool === 'select';

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        mouseButtons={{
          LEFT: panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
        onStart={() => invalidate()}
        onChange={() => invalidate()}
      />
      <Grid
        position={[0, -0.005, 0]}
        args={[10, 10]}
        cellSize={0.25}
        cellThickness={0.6}
        cellColor="#1a2230"
        sectionSize={1.25}
        sectionThickness={1}
        sectionColor="#2a3547"
        fadeDistance={70}
        fadeStrength={1.5}
        infiniteGrid
      />
      {showGizmo && selObject && (
        <TransformControls
          ref={tcRef}
          object={selObject}
          mode={transformMode}
          // Holding Space must pan, not drag whatever the gizmo is over.
          enabled={!panMode}
          translationSnap={0.05}
          rotationSnap={Math.PI / 24}
          scaleSnap={0.05}
          // Expose only the axes the model can persist: no vertical move, and
          // rotation about Y alone.
          showX={transformMode !== 'rotate'}
          showZ={transformMode !== 'rotate'}
          showY={transformMode !== 'translate'}
          onMouseDown={() => {
            isTransforming.current = true;
            gizmoRecent.current = true;
            transformInit.current = {
              px: selObject.position.x,
              pz: selObject.position.z,
              ry: selObject.rotation.y,
              sx: selObject.scale.x,
            };
          }}
          onMouseUp={() => {
            isTransforming.current = false;
            commitTransformRef.current();
            // Release the latch once this event has finished propagating.
            requestAnimationFrame(() => {
              gizmoRecent.current = false;
            });
          }}
          onObjectChange={constrainToModel}
        />
      )}
    </>
  );
}

function kindOfId(id: string): string | null {
  if (id.startsWith('wall-')) return 'wall';
  if (id.startsWith('obj-') || id.startsWith('object-') || id.startsWith('plant-')) return 'object';
  if (id.startsWith('door-')) return 'door';
  if (id.startsWith('win-')) return 'window';
  if (id.startsWith('room-')) return 'room';
  return null;
}

function resolveHit(hit: THREE.Intersection): { id: string } | null {
  const instMesh = hit.object as THREE.InstancedMesh;
  if (instMesh.isInstancedMesh && instMesh.userData.instanceEntities && hit.instanceId !== undefined) {
    const list = instMesh.userData.instanceEntities as { id: string }[];
    const ent = list[hit.instanceId];
    if (ent) return { id: ent.id };
  }
  let o: THREE.Object3D | null = hit.object;
  while (o) {
    const e = o.userData.entity as { id?: string } | undefined;
    if (e && e.id) return { id: e.id };
    o = o.parent;
  }
  return null;
}

function findEntityByTree(group: THREE.Object3D, kind: string, id: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  group.traverse((o) => {
    const e = o.userData.entity as { kind?: string; id?: string } | undefined;
    if (e && e.kind === kind && e.id === id) found = o;
  });
  return found;
}

function selId(obj: THREE.Object3D): string {
  const e = obj.userData.entity as { id?: string } | undefined;
  if (e?.id) return e.id;
  for (const f of useEditorStore.getState().project.floors) {
    const hit = f.objects.find((o) => o.id === obj.userData.objId);
    if (hit) return hit.id;
  }
  return '';
}

function sceneBounds(project: import('@interior/core').Project, activeFloorId: string) {
  const floor = project.floors.find((f) => f.id === activeFloorId) ?? project.floors[0];
  const pts: THREE.Vector3[] = [new THREE.Vector3(-1, 0, -1), new THREE.Vector3(7, 3, 7)];
  for (const w of floor.walls) {
    pts.push(
      new THREE.Vector3(w.a.x, floor.elevation, w.a.y),
      new THREE.Vector3(w.b.x, floor.elevation + w.height, w.b.y),
    );
  }
  for (const r of floor.rooms) for (const p of r.points) pts.push(new THREE.Vector3(p.x, floor.elevation, p.y));
  for (const o of floor.objects) pts.push(new THREE.Vector3(o.x, floor.elevation, o.z));
  const min = new THREE.Vector3(
    Math.min(...pts.map((p) => p.x)),
    Math.min(...pts.map((p) => p.y)),
    Math.min(...pts.map((p) => p.z)),
  );
  const max = new THREE.Vector3(
    Math.max(...pts.map((p) => p.x)),
    Math.max(...pts.map((p) => p.y)),
    Math.max(...pts.map((p) => p.z)),
  );
  const span = Math.max(max.x - min.x, max.z - min.z, 3);
  return {
    cx: (min.x + max.x) / 2,
    cz: (min.z + max.z) / 2,
    y0: min.y,
    y1: max.y,
    mid: (min.y + max.y) / 2,
    span,
  };
}

function camLookAt(camera: THREE.Camera, controls: any, target: THREE.Vector3): void {
  if (controls) {
    controls.target.copy(target);
    controls.update();
  } else {
    camera.lookAt(target);
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export {};
