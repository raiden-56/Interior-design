'use client';

/**
 * The walkthrough inside the existing 3D canvas.
 *
 * Mounted by Canvas3D next to the orbit controls, this component owns the
 * runtime for as long as a walkthrough lasts: it flies the camera from the
 * editor view to the player's eye, runs the simulation every frame, swings
 * the door leaves of the *same* meshes the editor drew, adds the things the
 * editor leaves out (ceilings, room lights, the route line, the avatar) and
 * flies back to exactly where the editor camera was. The project model is
 * never duplicated: the scene group it walks through is the one the editor
 * built from it.
 */

import * as React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { polygonArea, polygonCentroid } from '@interior/core';
import { useEditorStore } from '@/stores/editor-store';
import { useUiStore, type RenderPreset } from '@/stores/ui-store';
import { useWalkthroughStore } from '@/stores/walkthrough-store';
import { MeshPool, buildCeilingMesh, poseDoorPart, poseElevatorDoor, type DoorHinge } from '@/lib/three/meshes';
import { disposeScene, stairwellHolesAt } from '@/lib/three/scene';
import { WalkthroughRuntime, type RuntimeEvents } from './PlayerController';
import { InputController } from './InputController';
import { PoseTween, captureCamera, cameraPoseFor, restoreCamera, type CameraMemento } from './WalkthroughCamera';
import { setRuntime } from './runtime';
import { setLockHandler, setInputController, isTouchDevice } from './hud-bridge';
import type { WalkLighting } from './WalkSettings';
import { interactionOf } from './FurnitureInteraction';

interface SessionLike {
  group: THREE.Group;
}

const ENTER_MS = 1100;
const EXIT_MS = 850;
const MAX_ROOM_LIGHTS = 16;
const MAX_LAMP_LIGHTS = 12;

const LIGHTING_TO_PRESET: Record<WalkLighting, RenderPreset> = { day: 'daylight', evening: 'evening', night: 'night' };
const ROOM_LIGHT_INTENSITY: Record<WalkLighting, number> = { day: 0.35, evening: 1.6, night: 2.4 };
const LAMP_INTENSITY: Record<WalkLighting, number> = { day: 0.8, evening: 1.6, night: 2.2 };

export function WalkthroughRig({ getSession, controlsRef, structureKey }: { getSession: () => SessionLike | null; controlsRef: React.RefObject<any>; structureKey: string }) {
  const { camera, scene, gl, invalidate } = useThree();
  const phase = useWalkthroughStore((s) => s.phase);
  const mode = useWalkthroughStore((s) => s.mode);
  const lighting = useWalkthroughStore((s) => s.lighting);
  const ceilingVisible = useWalkthroughStore((s) => s.ceilingVisible);
  const designView = useWalkthroughStore((s) => s.designView);
  const settings = useWalkthroughStore((s) => s.settings);
  const routeNonce = useWalkthroughStore((s) => s.routeNonce);
  const project = useEditorStore((s) => s.project);

  const runtimeRef = React.useRef<WalkthroughRuntime | null>(null);
  const inputRef = React.useRef<InputController | null>(null);
  const tween = React.useRef(new PoseTween());
  const memento = React.useRef<CameraMemento | null>(null);
  const savedPreset = React.useRef<RenderPreset | null>(null);
  const extras = React.useRef<{ pool: MeshPool; ceilings: THREE.Group; lights: THREE.Group; route: THREE.Group; lamps: Map<string, THREE.PointLight> } | null>(null);
  const avatarRef = React.useRef<THREE.Group>(null);
  const doorParts = React.useRef<{ group: THREE.Object3D | null; parts: { id: string; part: THREE.Object3D }[]; lifts: { id: string; part: THREE.Object3D }[] }>({ group: null, parts: [], lifts: [] });
  const designSwap = React.useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());
  const lastTime = React.useRef(0);
  const hintTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const perspective = camera as THREE.PerspectiveCamera;

  // --- events from the runtime into the store (low frequency) -------------------
  const events = React.useMemo<RuntimeEvents>(() => {
    const st = () => useWalkthroughStore.getState();
    return {
      location: (loc) => st().setLocation(loc),
      prompt: (p) => st().setPrompt(p),
      notice: (t) => st().setNotice(t),
      info: (i) => st().setInfo(i),
      sitting: (s) => st().setSitting(s),
      elevatorPicker: (p) => {
        st().setElevatorPicker(p);
        if (p && document.pointerLockElement) document.exitPointerLock();
      },
      riding: (v) => st().setRiding(v),
      route: (r, target) => {
        st().setNavTarget(r && target ? { id: target.id, label: target.label, length: r.length } : null);
        st().bumpRoute();
      },
      floorChanged: () => undefined,
    };
  }, []);

  // --- hotkeys ------------------------------------------------------------------------
  const hotkey = React.useCallback(
    (code: string, e: KeyboardEvent): boolean => {
      const st = useWalkthroughStore.getState();
      const rt = runtimeRef.current;
      if (st.phase !== 'active') return code === 'Escape';
      switch (code) {
        case 'Escape':
          // While the pointer is locked the browser consumes Esc itself (it
          // unlocks); this only fires when we are already paused.
          if (st.elevatorPicker) st.setElevatorPicker(null);
          else if (st.navOpen || st.floorsOpen || st.settingsOpen) {
            st.setNavOpen(false);
            st.setFloorsOpen(false);
            st.setSettingsOpen(false);
          } else if (st.info) st.setInfo(null);
          else st.requestExit();
          return true;
        case 'KeyE':
          if (st.elevatorPicker || e.ctrlKey || e.metaKey) return false;
          rt?.interact();
          return true;
        case 'KeyC':
          if (e.ctrlKey || e.metaKey) return false;
          st.toggleCeiling();
          return true;
        case 'KeyX':
          if (e.ctrlKey || e.metaKey) return false;
          st.toggleDesignView();
          return true;
        case 'KeyF':
          if (e.ctrlKey || e.metaKey) return false;
          st.toggleImmersive();
          return true;
        case 'KeyH':
          st.toggleHud();
          return true;
        case 'KeyM':
          if (e.ctrlKey || e.metaKey) return false;
          st.cycleMinimap();
          return true;
        case 'KeyN':
          if (e.ctrlKey || e.metaKey) return false;
          st.setNavOpen(!st.navOpen);
          if (!st.navOpen) releasePointer();
          return true;
        case 'KeyJ':
          st.setFloorsOpen(!st.floorsOpen);
          if (!st.floorsOpen) releasePointer();
          return true;
        case 'KeyO':
          st.setSettingsOpen(!st.settingsOpen);
          if (!st.settingsOpen) releasePointer();
          return true;
        case 'KeyL':
          st.setLighting(st.lighting === 'day' ? 'evening' : st.lighting === 'evening' ? 'night' : 'day');
          return true;
        case 'Digit1':
        case 'Numpad1':
          st.setMode('first');
          return true;
        case 'Digit2':
        case 'Numpad2':
          st.setMode('third');
          return true;
        case 'Digit3':
        case 'Numpad3':
          st.setMode('free');
          return true;
        case 'Tab':
          return true;
        default:
          return false;
      }
    },
    [],
  );

  // --- enter -------------------------------------------------------------------------------
  React.useEffect(() => {
    if (phase !== 'entering') return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      begin();
    });
    const begin = () => {
    const controls = controlsRef.current ?? null;
    memento.current = captureCamera(perspective, controls);
    savedPreset.current = useUiStore.getState().renderPreset;

    const st = useWalkthroughStore.getState();
    const rt = new WalkthroughRuntime(useEditorStore.getState().project, st.settings, events, () => getSession()?.group ?? null);
    rt.setMode(st.mode);
    runtimeRef.current = rt;
    setRuntime(rt);

    const eye = rt.spawn();
    const from = { position: perspective.position.clone(), quaternion: perspective.quaternion.clone(), fov: perspective.fov };
    tween.current.begin(from, cameraPoseFor(eye, st.settings.fov), st.settings.reducedMotion ? 320 : ENTER_MS);

    const input = new InputController(hotkey);
    inputRef.current = input;
    setInputController(input);

    // Walkthrough extras live in their own group so leaving is one removal.
    const pool = new MeshPool();
    const ex = { pool, ceilings: new THREE.Group(), lights: new THREE.Group(), route: new THREE.Group(), lamps: new Map<string, THREE.PointLight>() };
    ex.ceilings.name = 'walkthrough:ceilings';
    ex.lights.name = 'walkthrough:lights';
    ex.route.name = 'walkthrough:route';
    for (const g of [ex.ceilings, ex.lights, ex.route]) scene.add(g);
    extras.current = ex;
    buildExtras();

    useUiStore.getState().setRenderPreset(LIGHTING_TO_PRESET[st.lighting]);
    lastTime.current = performance.now();
    };
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // --- exit -------------------------------------------------------------------------------
  React.useEffect(() => {
    if (phase !== 'exiting') return;
    if (document.pointerLockElement) document.exitPointerLock();
    const m = memento.current;
    const st = useWalkthroughStore.getState();
    const from = { position: perspective.position.clone(), quaternion: perspective.quaternion.clone(), fov: perspective.fov };
    if (m) tween.current.begin(from, { position: m.position, quaternion: m.quaternion, fov: m.fov }, st.settings.reducedMotion ? 260 : EXIT_MS);
    else tween.current.cancel();
    inputRef.current?.detach();
    runtimeRef.current?.clearRoute();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const finishExit = React.useCallback(() => {
    const m = memento.current;
    const controls = controlsRef.current ?? null;
    if (m) restoreCamera(perspective, controls, m);
    memento.current = null;
    // Door leaves back to the editor's hint angle, lifts closed.
    for (const { part } of doorParts.current.parts) poseDoorPart(part, (part.userData.doorHinge as DoorHinge | undefined)?.editorAngle ?? 0);
    for (const { part } of doorParts.current.lifts) poseElevatorDoor(part, 0);
    doorParts.current = { group: null, parts: [], lifts: [] };
    restoreDesignView(designSwap.current);
    const ex = extras.current;
    if (ex) {
      for (const g of [ex.ceilings, ex.lights, ex.route]) {
        scene.remove(g);
        disposeScene(g, ex.pool);
      }
      ex.pool.disposeAll();
      extras.current = null;
    }
    if (savedPreset.current) useUiStore.getState().setRenderPreset(savedPreset.current);
    savedPreset.current = null;
    runtimeRef.current?.dispose();
    runtimeRef.current = null;
    inputRef.current?.detach();
    inputRef.current = null;
    setRuntime(null);
    setInputController(null);
    setLockHandler(null);
    gl.domElement.style.cursor = '';
    useWalkthroughStore.getState().finishExit();
    requestAnimationFrame(() => invalidate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perspective, scene, gl, invalidate]);

  // --- pointer lock -------------------------------------------------------------------------
  React.useEffect(() => {
    if (phase !== 'active') return;
    const el = gl.domElement;
    const st = useWalkthroughStore.getState();
    const input = inputRef.current;
    const touch = isTouchDevice();

    const lock = () => {
      if (touch) {
        st.setPaused(false);
        return;
      }
      if (document.pointerLockElement === el) return;
      const p = el.requestPointerLock?.({ unadjustedMovement: true } as any) as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => el.requestPointerLock());
    };
    setLockHandler(lock);

    const onLockChange = () => {
      const locked = document.pointerLockElement === el;
      if (input) input.looking = locked || touch;
      useWalkthroughStore.getState().setPaused(!locked && !touch);
      if (locked && useWalkthroughStore.getState().hintVisible) {
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => useWalkthroughStore.getState().setHintVisible(false), 4500);
      }
    };
    const onLockError = () => useWalkthroughStore.getState().setPaused(true);
    const onCanvasClick = () => {
      const s = useWalkthroughStore.getState();
      if (s.phase !== 'active') return;
      if (document.pointerLockElement === el) {
        // Mouse is captured: a click does what E does.
        runtimeRef.current?.interact();
        return;
      }
      if (s.paused && !s.elevatorPicker && !s.navOpen && !s.floorsOpen && !s.settingsOpen) lock();
    };

    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', onLockError);
    el.addEventListener('click', onCanvasClick);
    input?.attach();
    if (input) input.looking = touch;
    st.setPaused(!touch);
    el.style.cursor = touch ? '' : 'crosshair';
    if (st.hintVisible) {
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => useWalkthroughStore.getState().setHintVisible(false), 9000);
    }
    return () => {
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      el.removeEventListener('click', onCanvasClick);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, [phase, gl]);

  // --- keep the runtime in step with React-side state -------------------------------------
  React.useEffect(() => {
    runtimeRef.current?.setProject(project);
  }, [project]);
  React.useEffect(() => {
    runtimeRef.current?.setSettings(settings);
    if (phase === 'active' && Math.abs(perspective.fov - settings.fov) > 0.01 && !tween.current.running) {
      perspective.fov = settings.fov;
      perspective.updateProjectionMatrix();
    }
  }, [settings, phase, perspective]);
  React.useEffect(() => {
    runtimeRef.current?.setMode(mode);
  }, [mode]);
  React.useEffect(() => {
    if (phase === 'off') return;
    useUiStore.getState().setRenderPreset(LIGHTING_TO_PRESET[lighting]);
    const ex = extras.current;
    if (!ex) return;
    ex.lights.traverse((o) => {
      const l = o as THREE.PointLight;
      if (l.isPointLight && l.userData.roomLight) l.intensity = ROOM_LIGHT_INTENSITY[lighting] * (l.userData.scale ?? 1);
    });
  }, [lighting, phase]);

  // --- ceilings + room lights: rebuilt with the structure -------------------------------------
  const buildExtras = React.useCallback(() => {
    const ex = extras.current;
    if (!ex) return;
    const p = useEditorStore.getState().project;
    for (const g of [ex.ceilings, ex.lights]) {
      disposeScene(g, ex.pool);
      g.clear();
    }
    ex.lamps.clear();

    type RoomLight = { x: number; y: number; z: number; area: number; span: number };
    const roomLights: RoomLight[] = [];
    for (const floor of p.floors) {
      if (!floor.visible) continue;
      const ceilingY = floor.elevation + floor.height;
      const holes = stairwellHolesAt(p, ceilingY);
      for (const room of floor.rooms) {
        if (room.points.length < 3) continue;
        ex.ceilings.add(buildCeilingMesh(ex.pool, room, ceilingY, holes));
        const c = polygonCentroid(room.points);
        const area = Math.abs(polygonArea(room.points));
        // Hung well below the ceiling: a point light flush against a surface
        // paints a hard hotspot on it instead of lighting the room.
        roomLights.push({ x: c.x, y: ceilingY - 0.9, z: c.y, area, span: Math.sqrt(area) });
      }
      for (const o of floor.objects) {
        const t = interactionOf(o).type;
        if (t !== 'light' || ex.lamps.size >= MAX_LAMP_LIGHTS) continue;
        const light = new THREE.PointLight('#ffd9a8', 0, Math.max(3, o.height * o.scale * 2.5), 2);
        const head = o.shape === 'pendant' ? o.height * o.scale - 0.5 : o.height * o.scale * 0.9;
        light.position.set(o.x, floor.elevation + head, o.z);
        light.userData.lamp = o.id;
        ex.lights.add(light);
        ex.lamps.set(o.id, light);
      }
    }
    roomLights.sort((a, b) => b.area - a.area).slice(0, MAX_ROOM_LIGHTS).forEach((r) => {
      const scale = Math.min(1.6, Math.max(0.6, r.span / 3.5));
      const light = new THREE.PointLight('#fff1dc', ROOM_LIGHT_INTENSITY[useWalkthroughStore.getState().lighting] * scale, Math.max(6, r.span * 2.2), 1.6);
      light.position.set(r.x, r.y, r.z);
      light.userData.roomLight = true;
      light.userData.scale = scale;
      ex.lights.add(light);
    });
    ex.ceilings.visible = useWalkthroughStore.getState().ceilingVisible;
  }, []);
  React.useEffect(() => {
    if (phase === 'off') return;
    buildExtras();
  }, [structureKey, phase, buildExtras]);

  React.useEffect(() => {
    const ex = extras.current;
    if (ex) ex.ceilings.visible = ceilingVisible;
  }, [ceilingVisible]);

  // --- design view: translucent walls -------------------------------------------------------
  React.useEffect(() => {
    if (phase === 'off') return;
    const group = getSession()?.group;
    restoreDesignView(designSwap.current);
    if (!designView || !group) return;
    const cache = new Map<THREE.Material, THREE.Material>();
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const e = mesh.userData.entity as { kind?: string } | undefined;
      if (e?.kind !== 'wall') return;
      const original = mesh.material;
      designSwap.current.set(mesh, original);
      const mats = Array.isArray(original) ? original : [original];
      mesh.material = mats.map((m) => {
        let c = cache.get(m);
        if (!c) {
          c = m.clone();
          c.transparent = true;
          c.opacity = 0.28;
          c.depthWrite = false;
          (c as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
          cache.set(m, c);
        }
        return c;
      })[0];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designView, structureKey, phase]);

  // --- route line --------------------------------------------------------------------------
  React.useEffect(() => {
    const ex = extras.current;
    const rt = runtimeRef.current;
    if (!ex || !rt) return;
    disposeScene(ex.route, ex.pool);
    ex.route.clear();
    const pts = rt.routePoints();
    if (pts.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y + 0.04, p.z)));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.9 }));
    line.userData.walkthroughHelper = true;
    ex.route.add(line);
    // Breadcrumb dots make the line legible on busy floors.
    const dotGeo = new THREE.SphereGeometry(0.045, 8, 6);
    const dotMat = ex.pool.mat('#7dd3fc', 0.4, 0);
    pts.forEach((p, i) => {
      if (i % 2) return;
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.position.set(p.x, p.y + 0.05, p.z);
      d.userData.walkthroughHelper = true;
      ex.route.add(d);
    });
    const end = pts[pts.length - 1];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 8, 32), ex.pool.mat('#38bdf8', 0.4, 0));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(end.x, end.y + 0.06, end.z);
    ring.userData.walkthroughHelper = true;
    ex.route.add(ring);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeNonce]);

  // --- frame loop --------------------------------------------------------------------------
  useFrame(() => {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastTime.current) / 1000));
    lastTime.current = now;
    const st = useWalkthroughStore.getState();
    const rt = runtimeRef.current;
    if (!rt || st.phase === 'off') return;
    if (!extras.current) return; // entering, runtime not started yet

    const input = inputRef.current;
    const frozen = st.phase !== 'active' || st.paused || !!st.elevatorPicker;
    const frameInput = input && !frozen ? input.frame(dt) : { forward: 0, strafe: 0, sprint: false, slow: false, jump: false, lookDX: 0, lookDY: 0, interact: false };
    if (input && frozen) input.frame(dt); // drain so a held key does not burst on resume

    if (st.phase === 'entering') {
      rt.update(dt, frameInput, perspective, true);
      if (tween.current.apply(perspective, now)) st.setPhase('active');
    } else if (st.phase === 'exiting') {
      rt.update(dt, frameInput, perspective, true);
      if (tween.current.apply(perspective, now)) finishExit();
      return;
    } else {
      // Paused (pointer released, a panel open) still runs the simulation with
      // idle input, so a floor jump or a lift ride made from a panel is seen
      // immediately rather than after the next click.
      rt.update(dt, frameInput, perspective, false);
      if (st.hintVisible && input?.moving) st.setHintVisible(false);
    }

    // Door leaves and lift panels follow the runtime every frame.
    const group = getSession()?.group ?? null;
    if (group !== doorParts.current.group) doorParts.current = collectDoorParts(group);
    for (const { id, part } of doorParts.current.parts) poseDoorPart(part, rt.doors.angleOf(id));
    for (const { id, part } of doorParts.current.lifts) poseElevatorDoor(part, rt.elevator.doorOpenFor(id));

    // Lamps toggled by E.
    const ex = extras.current;
    if (ex) {
      const target = LAMP_INTENSITY[st.lighting];
      for (const [id, light] of ex.lamps) {
        const want = rt.lightOn(id) ? target : 0;
        if (Math.abs(light.intensity - want) > 1e-3) light.intensity += (want - light.intensity) * Math.min(1, dt * 12);
      }
    }

    // Avatar follows the body in third person.
    const avatar = avatarRef.current;
    if (avatar) {
      const show = st.mode === 'third' && st.phase === 'active';
      avatar.visible = show;
      if (show) {
        const eye = rt.eyePose();
        avatar.position.set(eye.x, rt.player.y, eye.z);
        avatar.rotation.y = rt.thirdPerson.bodyYaw;
        avatar.scale.y = rt.sitting.seated ? 0.62 : 1;
      }
    }
  });

  // Unmount while active (route change, canvas error): put the camera back.
  React.useEffect(() => {
    return () => {
      if (runtimeRef.current || memento.current) finishExit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'off') return null;
  const h = settings.playerHeight;
  return (
    <group ref={avatarRef} visible={false}>
      <mesh position={[0, h * 0.45, 0]} userData={{ walkthroughHelper: true }} castShadow>
        <capsuleGeometry args={[0.22, h * 0.5, 6, 14]} />
        <meshStandardMaterial color="#4f6f9f" roughness={0.7} />
      </mesh>
      <mesh position={[0, h * 0.9, 0]} userData={{ walkthroughHelper: true }} castShadow>
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshStandardMaterial color="#e9c9a8" roughness={0.8} />
      </mesh>
      {/* A nose, so the facing direction reads at a glance. */}
      <mesh position={[0, h * 0.9, -0.13]} userData={{ walkthroughHelper: true }}>
        <boxGeometry args={[0.05, 0.05, 0.06]} />
        <meshStandardMaterial color="#d9b394" />
      </mesh>
    </group>
  );
}

function releasePointer(): void {
  if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
}

function collectDoorParts(group: THREE.Object3D | null): { group: THREE.Object3D | null; parts: { id: string; part: THREE.Object3D }[]; lifts: { id: string; part: THREE.Object3D }[] } {
  const parts: { id: string; part: THREE.Object3D }[] = [];
  const lifts: { id: string; part: THREE.Object3D }[] = [];
  if (!group) return { group, parts, lifts };
  group.traverse((o) => {
    const dp = o.userData.doorPart as string | undefined;
    if (!dp) return;
    if (dp === 'elevatorDoor') {
      let p: THREE.Object3D | null = o;
      while (p && !(p.userData.entity as { id?: string } | undefined)?.id) p = p.parent;
      const id = (p?.userData.entity as { id?: string } | undefined)?.id;
      if (id) lifts.push({ id, part: o });
      return;
    }
    const e = o.userData.entity as { kind?: string; id?: string } | undefined;
    if (e?.kind === 'door' && e.id) parts.push({ id: e.id, part: o });
  });
  return { group, parts, lifts };
}

function restoreDesignView(swap: Map<THREE.Mesh, THREE.Material | THREE.Material[]>): void {
  for (const [mesh, material] of swap) {
    const current = mesh.material;
    mesh.material = material;
    const mats = Array.isArray(current) ? current : [current];
    for (const m of mats) if (m !== material && !(Array.isArray(material) && material.includes(m))) m.dispose();
  }
  swap.clear();
}
