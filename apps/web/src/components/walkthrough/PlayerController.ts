/**
 * The walkthrough runtime: input → body → doors, seats, lifts → camera.
 *
 * One instance lives for the duration of a walkthrough and is advanced once
 * per rendered frame by the React rig. It owns every high-frequency value
 * (position, velocity, look angles) and talks to React only through the
 * `events` callbacks, which fire when something *readable* changes. That
 * separation is what keeps the frame rate independent of React rendering.
 */

import * as THREE from 'three';
import type { Project, ProjectObject } from '@interior/core';
import { polygonArea } from '@interior/core';
import { bodyOf, lookRate, type CameraMode, type WalkSettings } from './WalkSettings';
import {
  buildCollisionWorld,
  collisionSignature,
  floorInfo,
  groundAt,
  roomAt,
  type BlockQuery,
  type CollisionWorld,
} from './WalkthroughCollision';
import { createPlayer, placePlayer, stepPlayer, type MoveInput, type PlayerState, IDLE_INPUT } from './PlayerPhysics';
import { DoorController } from './DoorController';
import { SittingController, type Pose } from './SittingController';
import { ElevatorController, ELEVATOR_APPROACH_RADIUS } from './ElevatorController';
import { buildInteractables, findLookTarget, promptFor, type Interactable, type Prompt } from './InteractionSystem';
import { resolveStart, safePointOnFloor, type StartPose } from './SpawnPoint';
import { NavGrid, destinationsFor, sampleRoute, type Destination, type NavPoint, type Route } from './WalkthroughNavigation';
import { FirstPersonController, applyLook, MAX_PITCH } from './FirstPersonController';
import { ThirdPersonController } from './ThirdPersonController';
import { forwardOf, rightOf } from './PlayerPhysics';

export interface RuntimeEvents {
  location: (loc: { floorId: string | null; floorName: string; roomId: string | null; roomName: string; roomArea: number | null }) => void;
  prompt: (p: Prompt | null) => void;
  notice: (text: string) => void;
  info: (info: { title: string; lines: string[] } | null) => void;
  sitting: (s: { objectId: string; name: string; kind: 'sit' | 'lie' } | null) => void;
  elevatorPicker: (p: { objectId: string; floors: { id: string; name: string; current: boolean }[] } | null) => void;
  riding: (v: boolean) => void;
  route: (r: Route | null, target: Destination | null) => void;
  floorChanged: (floorId: string) => void;
}

/** Per-frame input, already merged from keyboard, mouse, touch and gamepad. */
export interface FrameInput extends MoveInput {
  lookDX: number;
  lookDY: number;
  interact: boolean;
}

export interface PlayerSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  floorId: string | null;
  speed: number;
  seated: boolean;
}

export class WalkthroughRuntime {
  world: CollisionWorld;
  player: PlayerState;
  readonly doors: DoorController;
  readonly sitting = new SittingController();
  readonly elevator = new ElevatorController();
  interactables: Map<string, Interactable>;
  settings: WalkSettings;
  mode: CameraMode = 'first';
  project: Project;
  readonly firstPerson = new FirstPersonController();
  readonly thirdPerson = new ThirdPersonController();
  /** Free camera pose (mode 'free'); independent of the body. */
  readonly freePose: Pose = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };

  private signature: string;
  private lights = new Set<string>();
  private opened = new Set<string>();
  private lookTarget: Interactable | null = null;
  private lastPrompt: Prompt | null = null;
  private lookTimer = 0;
  private raycaster = new THREE.Raycaster();
  private nav: NavGrid | null = null;
  private navSignature = '';
  private route: Route | null = null;
  private routeTarget: Destination | null = null;
  private routeLine: NavPoint[] = [];
  private lastRoom: string | null = null;
  private lastFloor: string | null = null;
  private lastSpawn: StartPose | null = null;
  private frozenPose: Pose | null = null;
  private bodyFloorY = 0;

  private readonly events: RuntimeEvents;
  private readonly getWorldRoot: () => THREE.Object3D | null;

  constructor(project: Project, settings: WalkSettings, events: RuntimeEvents, getWorldRoot: () => THREE.Object3D | null) {
    this.events = events;
    this.getWorldRoot = getWorldRoot;
    this.project = project;
    this.settings = settings;
    this.signature = collisionSignature(project);
    this.world = buildCollisionWorld(project);
    this.doors = new DoorController(project, { autoDoors: settings.autoDoors });
    this.interactables = buildInteractables(project);
    this.player = createPlayer(0, 0, 0, 0, this.world.floors[0]?.id ?? null);
    this.raycaster.params.Line = { threshold: 0 };
    this.raycaster.params.Points = { threshold: 0 };
  }

  // --- lifecycle ---------------------------------------------------------------

  /** Picks the start pose and puts the body there. Returns the eye pose for the entry flight. */
  spawn(): Pose {
    const start = resolveStart(this.project, this.world, bodyOf(this.settings), this.blockQuery());
    this.teleport(start);
    this.lastSpawn = start;
    return this.eyePose();
  }

  teleport(pose: StartPose): void {
    placePlayer(this.player, this.world, pose.x, pose.y, pose.z, pose.yaw, this.settings.stepHeight);
    this.player.floorId = pose.floorId;
    this.firstPerson.reset();
    this.thirdPerson.reset(pose.yaw);
    this.sitting.reset();
    this.events.sitting(null);
    this.freePose.x = pose.x;
    this.freePose.y = pose.y + this.settings.eyeHeight;
    this.freePose.z = pose.z;
    this.freePose.yaw = pose.yaw;
    this.freePose.pitch = 0;
    this.announceLocation(true);
  }

  /** Keeps the world in step with the project. Cheap when nothing physical changed. */
  setProject(project: Project): void {
    this.project = project;
    const sig = collisionSignature(project);
    if (sig === this.signature) return;
    this.signature = sig;
    this.world = buildCollisionWorld(project);
    this.doors.sync(project);
    this.interactables = buildInteractables(project);
    this.nav = null;
    // Let gravity settle the body onto whatever is under it now.
    const g = groundAt(this.world, this.player.x, this.player.z, this.player.y + 0.3, this.settings.stepHeight + 0.3);
    if (g) {
      this.player.y = g.y;
      this.player.floorId = g.floorId;
    }
    if (this.route && this.routeTarget) this.navigateTo(this.routeTarget);
  }

  setSettings(s: WalkSettings): void {
    this.settings = s;
    this.doors.setAutoDoors(s.autoDoors);
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    if (mode === 'free') {
      const eye = this.eyePose();
      Object.assign(this.freePose, eye);
    } else if (this.mode === 'free') {
      // Coming back from the free camera: drop the body under the camera.
      const g = groundAt(this.world, this.freePose.x, this.freePose.z, this.freePose.y, 50);
      const y = g ? g.y : this.player.y;
      placePlayer(this.player, this.world, this.freePose.x, y, this.freePose.z, this.freePose.yaw, this.settings.stepHeight);
      this.player.pitch = this.freePose.pitch;
      this.firstPerson.reset();
    }
    this.mode = mode;
    this.thirdPerson.reset(this.player.yaw);
  }

  dispose(): void {
    this.doors.reset();
    this.elevator.reset();
    this.sitting.reset();
  }

  // --- queries ---------------------------------------------------------------

  private blockQuery(): BlockQuery {
    return {
      doorBlocks: (id) => (id.startsWith('elev:') ? this.elevator.isBlocking(id.slice(5)) : this.doors.isBlocking(id)),
      ignoreObjectId: this.sitting.state.objectId,
    };
  }

  /** The eye pose the camera is (or would be) at, in first person. */
  eyePose(): Pose {
    if (this.mode === 'free') return { ...this.freePose };
    const sitPose = this.sitting.currentPose();
    if (sitPose) return { ...sitPose };
    if (this.frozenPose) return { ...this.frozenPose };
    return { x: this.player.x, y: this.player.y + this.settings.eyeHeight, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch };
  }

  /** What the camera currently shows (after smoothing), for the exit flight. */
  shownPose(): Pose {
    return this.mode === 'first' ? { ...this.firstPerson.shown } : this.eyePose();
  }

  snapshot(): PlayerSnapshot {
    const eye = this.eyePose();
    return { x: eye.x, y: this.player.y, z: eye.z, yaw: eye.yaw, floorId: this.player.floorId, speed: this.player.speed, seated: this.sitting.seated };
  }

  routePoints(): NavPoint[] {
    return this.routeLine;
  }

  currentRoute(): { route: Route; target: Destination } | null {
    return this.route && this.routeTarget ? { route: this.route, target: this.routeTarget } : null;
  }

  lightOn(id: string): boolean {
    return this.lights.has(id);
  }

  isOpened(id: string): boolean {
    return this.opened.has(id);
  }

  destinations(): Destination[] {
    return destinationsFor(this.project, this.world);
  }

  floorsForJump(): { id: string; name: string; current: boolean }[] {
    return this.world.floors.map((f) => ({ id: f.id, name: f.name, current: f.id === this.player.floorId }));
  }

  // --- per-frame ---------------------------------------------------------------

  /**
   * One simulation step. `dt` in seconds; `camera` receives the final pose.
   * `frozen` (entering / exiting flights) still animates doors but ignores
   * input and leaves the camera to the caller.
   */
  update(dt: number, input: FrameInput, camera: THREE.PerspectiveCamera, frozen = false): void {
    const s = this.settings;
    const world = this.getWorldRoot();

    // Doors swing regardless; automatic ones react to the body.
    this.doors.update(dt, { x: this.player.x, y: this.player.y, z: this.player.z });

    if (frozen) return;

    // --- look ---------------------------------------------------------------
    const rate = lookRate(s);
    if (this.mode === 'free') {
      applyLook(this.freePose, input.lookDX, input.lookDY, rate, s.invertY);
      this.flyFree(dt, input);
      camera.position.set(this.freePose.x, this.freePose.y, this.freePose.z);
      camera.rotation.set(this.freePose.pitch, this.freePose.yaw, 0, 'YXZ');
      this.pollLookTarget(dt, camera, world, input.interact);
      return;
    }

    if (this.sitting.seated) {
      this.sitting.look(-input.lookDX * rate, (s.invertY ? 1 : -1) * input.lookDY * rate, MAX_PITCH);
    } else if (!this.sitting.busy && !this.elevator.riding) {
      applyLook(this.player, input.lookDX, input.lookDY, rate, s.invertY);
    }

    // --- lift ride ------------------------------------------------------------
    const near = this.nearestElevator();
    const ride = this.elevator.update(dt, near?.id ?? null);
    if (ride.y !== null) {
      this.player.y = ride.y;
      this.player.vx = this.player.vz = this.player.vy = 0;
      this.player.speed = 0;
      this.frozenPose = { x: this.player.x, y: ride.y + s.eyeHeight, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch };
    }
    if (ride.arrived) {
      this.frozenPose = null;
      const dest = ride.arrived;
      const g = groundAt(this.world, dest.x, dest.z, dest.toY + 0.3, s.stepHeight + 0.3);
      placePlayer(this.player, this.world, dest.x, g ? g.y : dest.toY, dest.z, this.player.yaw, s.stepHeight);
      this.player.floorId = dest.toFloorId;
      this.events.riding(false);
      this.events.notice(`Arrived at ${floorInfo(this.world, dest.toFloorId)?.name ?? 'floor'}`);
      this.announceLocation(true);
    }

    // --- seat transitions -----------------------------------------------------
    const sit = this.sitting.update(dt);
    if (sit.finished === 'standing') {
      const spot = this.sitting.lastStandingSpot();
      if (spot) {
        placePlayer(this.player, this.world, spot.x, spot.y, spot.z, sit.pose?.yaw ?? spot.yaw, s.stepHeight);
        this.player.pitch = sit.pose?.pitch ?? 0;
      }
      this.events.sitting(null);
    }

    // --- body -------------------------------------------------------------------
    const controllable = !this.sitting.active && !this.elevator.riding;
    const move: MoveInput = controllable ? input : IDLE_INPUT;
    const res = stepPlayer(this.player, move, s, this.world, dt, this.blockQuery());
    if (res.fellOut) this.rescue();
    if (res.floorChanged || this.player.floorId !== this.lastFloor) this.announceLocation(false);
    else this.checkRoom();

    // --- camera -------------------------------------------------------------
    const override = sit.pose ?? this.frozenPose;
    if (this.mode === 'third') {
      const eye = override ?? { x: this.player.x, y: this.player.y + s.eyeHeight, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch };
      this.thirdPerson.update(camera, eye, this.player, world, dt);
    } else {
      this.firstPerson.update(camera, this.player, override, s, dt);
    }

    // --- what am I looking at ---------------------------------------------------
    this.pollLookTarget(dt, camera, world, input.interact);

    // --- route progress ---------------------------------------------------------
    if (this.routeTarget) {
      const d = Math.hypot(this.routeTarget.x - this.player.x, this.routeTarget.z - this.player.z);
      if (d < 1.0 && Math.abs(this.routeTarget.y - this.player.y) < 1.5) {
        this.events.notice(`You have reached ${this.routeTarget.label}`);
        this.clearRoute();
      }
    }
  }

  private flyFree(dt: number, input: FrameInput): void {
    const speed = (input.sprint ? 8 : input.slow ? 1.2 : 3.5) * dt;
    const f = forwardOf(this.freePose.yaw);
    const r = rightOf(this.freePose.yaw);
    const up = input.jump ? 1 : 0;
    // Forward follows the pitch so you can fly where you look.
    const cp = Math.cos(this.freePose.pitch);
    this.freePose.x += (f.x * cp * input.forward + r.x * input.strafe) * speed;
    this.freePose.z += (f.z * cp * input.forward + r.z * input.strafe) * speed;
    this.freePose.y += (Math.sin(this.freePose.pitch) * input.forward + up) * speed;
    this.freePose.y = Math.max(this.world.bounds.minY + 0.3, Math.min(this.world.bounds.maxY + 30, this.freePose.y));
  }

  private pollLookTarget(dt: number, camera: THREE.Camera, world: THREE.Object3D | null, interactPressed: boolean): void {
    this.lookTimer -= dt;
    if (this.lookTimer <= 0 || interactPressed) {
      this.lookTimer = 0.09;
      let target: Interactable | null = null;
      if (world) {
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const found = findLookTarget(this.raycaster, world, this.interactables);
        target = found?.target ?? null;
        // Seated: the only thing E does is stand up, whatever you look at.
        if (this.sitting.seated) target = this.interactables.get(this.sitting.state.objectId ?? '') ?? null;
      }
      this.lookTarget = target;
      const prompt = target ? promptFor(target, this.promptContext()) : null;
      if (!samePrompt(prompt, this.lastPrompt)) {
        this.lastPrompt = prompt;
        this.events.prompt(prompt);
      }
    }
    if (interactPressed) this.interact();
  }

  private promptContext() {
    return {
      seatedOn: this.sitting.seated ? this.sitting.state.objectId : null,
      doorPrompt: (id: string) => this.doors.promptFor(id),
      lightOn: (id: string) => this.lights.has(id),
      opened: (id: string) => this.opened.has(id),
      elevatorBusy: this.elevator.riding,
      floorName: (id: string | null) => floorInfo(this.world, id)?.name ?? null,
      stairsLeadTo: (objectId: string) => {
        const ramp = this.world.ramps.find((r) => r.objectId === objectId);
        return ramp?.toFloorId ? floorInfo(this.world, ramp.toFloorId)?.name ?? null : null;
      },
    };
  }

  // --- interactions ---------------------------------------------------------------

  /** E. Acts on whatever the crosshair is on (or stands up when seated). */
  interact(): void {
    if (this.sitting.busy || this.elevator.riding) return;
    if (this.sitting.seated) {
      const r = this.sitting.tryStand(this.world, this.player, this.settings, this.blockQuery());
      if (!r.ok) this.events.notice('No room to stand up here');
      return;
    }
    const t = this.lookTarget;
    if (!t) return;
    switch (t.type) {
      case 'door': {
        const r = this.doors.toggle(t.id);
        if (r === 'locked') this.events.notice('This door is locked');
        break;
      }
      case 'sit':
      case 'lie': {
        if (!t.object) return;
        const r = this.sitting.trySit(t.object, t.elevation, t.type, this.player, this.settings);
        if (r.ok) this.events.sitting({ objectId: t.id, name: t.name, kind: t.type });
        else if (r.reason === 'too far') this.events.notice('Move closer to sit');
        break;
      }
      case 'cabinet':
      case 'drawer': {
        if (this.opened.has(t.id)) this.opened.delete(t.id);
        else this.opened.add(t.id);
        this.events.notice(`${t.name} ${this.opened.has(t.id) ? 'opened' : 'closed'}`);
        break;
      }
      case 'light':
      case 'switch': {
        if (this.lights.has(t.id)) this.lights.delete(t.id);
        else this.lights.add(t.id);
        this.events.notice(`${t.name} ${this.lights.has(t.id) ? 'on' : 'off'}`);
        break;
      }
      case 'elevator':
        this.openElevatorPicker(t);
        break;
      case 'view':
      case 'inspect':
      case 'object':
        this.events.info(describe(t));
        break;
      default:
        break;
    }
    // The prompt usually changes after an interaction; refresh it now.
    this.lookTimer = 0;
  }

  private openElevatorPicker(t: Interactable): void {
    const floors = this.world.floors.map((f) => ({ id: f.id, name: f.name, current: f.id === this.player.floorId }));
    if (floors.filter((f) => !f.current).length === 0) {
      this.events.notice('This building has only one floor');
      return;
    }
    this.events.elevatorPicker({ objectId: t.id, floors });
  }

  /** Chosen floor in the lift picker. */
  rideTo(objectId: string, floorId: string): void {
    const cabin = this.interactables.get(objectId);
    const to = floorInfo(this.world, floorId);
    if (!cabin || !to || this.elevator.riding) return;
    // Arrive in a lift on the destination floor if there is one near the same spot.
    const destCabin = this.project.floors
      .find((f) => f.id === floorId)
      ?.objects.find((o) => o.shape === 'elevator' && Math.hypot(o.x - cabin.x, o.z - cabin.z) < 2.5);
    const x = destCabin?.x ?? cabin.x;
    const z = destCabin?.z ?? cabin.z;
    // Step into the car first so the ride starts from inside.
    this.player.x = cabin.x;
    this.player.z = cabin.z;
    this.player.vx = this.player.vz = 0;
    this.elevator.start({ objectId, fromY: this.player.y, toY: to.elevation, toFloorId: floorId, x, z });
    this.events.elevatorPicker(null);
    this.events.riding(true);
  }

  private nearestElevator(): Interactable | null {
    let best: Interactable | null = null;
    let bestD = ELEVATOR_APPROACH_RADIUS + 0.6;
    for (const i of this.interactables.values()) {
      if (i.type !== 'elevator' || Math.abs(i.elevation - this.player.y) > 1) continue;
      const d = Math.hypot(i.x - this.player.x, i.z - this.player.z);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }

  /** "Jump to floor": the nearest safe spot on that floor, keeping the heading. */
  jumpToFloor(floorId: string): boolean {
    if (this.sitting.active || this.elevator.riding) return false;
    const spot = safePointOnFloor(this.project, this.world, floorId, { x: this.player.x, z: this.player.z }, bodyOf(this.settings), this.blockQuery());
    if (!spot) {
      this.events.notice('That floor has nowhere to stand');
      return false;
    }
    this.teleport({ ...spot, yaw: this.player.yaw });
    this.events.notice(`Moved to ${floorInfo(this.world, floorId)?.name ?? 'floor'}`);
    return true;
  }

  /** Fell through the world: back to the last spawn, or the nearest safe spot. */
  private rescue(): void {
    const near = this.lastSpawn ?? safePointOnFloor(this.project, this.world, this.world.floors[0]?.id ?? '', null, bodyOf(this.settings), this.blockQuery());
    if (near) this.teleport(near);
    this.events.notice('Returned to safe position');
  }

  // --- navigation --------------------------------------------------------------------

  navigateTo(dest: Destination): boolean {
    const sig = this.signature + '|nav';
    if (!this.nav || this.navSignature !== sig) {
      const locked = new Set(this.doors.all().filter((d) => d.behavior === 'locked').map((d) => d.id));
      this.nav = new NavGrid(this.world, bodyOf(this.settings), { doorBlocks: (id) => locked.has(id) });
      this.navSignature = sig;
    }
    const from = { x: this.player.x, y: this.player.y, z: this.player.z };
    const route = this.nav.findPath(from, { x: dest.x, y: dest.y, z: dest.z });
    if (!route) {
      this.events.notice(`No walkable route to ${dest.label}`);
      return false;
    }
    this.route = route;
    this.routeTarget = dest;
    this.routeLine = sampleRoute(this.world, route);
    this.events.route(route, dest);
    return true;
  }

  clearRoute(): void {
    this.route = null;
    this.routeTarget = null;
    this.routeLine = [];
    this.events.route(null, null);
  }

  // --- location ------------------------------------------------------------------

  private announceLocation(force: boolean): void {
    const floor = floorInfo(this.world, this.player.floorId);
    const room = roomAt(this.world, this.player.floorId, this.player.x, this.player.z);
    const roomId = room?.id ?? null;
    if (!force && roomId === this.lastRoom && this.player.floorId === this.lastFloor) return;
    const floorChanged = this.player.floorId !== this.lastFloor;
    this.lastRoom = roomId;
    this.lastFloor = this.player.floorId;
    const rooms = this.world.roomsByFloor.get(this.player.floorId ?? '') ?? [];
    const idx = room ? rooms.indexOf(room) : -1;
    this.events.location({
      floorId: this.player.floorId,
      floorName: floor?.name ?? '',
      roomId,
      roomName: room ? room.name || `Room ${String(idx + 1).padStart(2, '0')}` : '',
      roomArea: room ? Math.abs(polygonArea(room.points)) : null,
    });
    if (floorChanged && this.player.floorId) this.events.floorChanged(this.player.floorId);
  }

  private roomTimer = 0;
  private checkRoom(): void {
    // Room membership only needs a few checks a second.
    this.roomTimer += 1;
    if (this.roomTimer % 6 !== 0) return;
    this.announceLocation(false);
  }
}

function samePrompt(a: Prompt | null, b: Prompt | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.key === b.key && a.text === b.text && a.passive === b.passive;
}

function describe(t: Interactable): { title: string; lines: string[] } {
  const o: ProjectObject | undefined = t.object;
  if (!o) return { title: t.name, lines: [] };
  const w = (o.width * o.scale).toFixed(2);
  const d = (o.depth * o.scale).toFixed(2);
  const h = (o.height * o.scale).toFixed(2);
  const lines = [`${w} × ${d} m · ${h} m high`];
  if (o.materialId) lines.push(`Material: ${o.materialId.replace(/^[a-z]+-/, '').replace(/-/g, ' ')}`);
  else if (o.color) lines.push(`Colour: ${o.color}`);
  return { title: o.name, lines };
}
