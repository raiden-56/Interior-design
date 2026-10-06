/**
 * Canonical Project Model.
 *
 * This is the SINGLE SOURCE OF TRUTH for the entire application.
 * - 2D (PixiJS) and 3D (Three.js) adapters *derive* their rendering from this model.
 * - No Three.js/PixiJS objects live here. Only plain, serializable data.
 * - All lengths are stored in METERS (display conversion happens at the UI layer).
 */

export type Vec2 = { x: number; y: number };
export type UnitSystem = 'meters' | 'centimeters' | 'feet';

/** A wall segment on a floor plan (top-down: x = east, y = north). */
export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  /** Wall height in meters. */
  height: number;
  /** Wall thickness in meters. */
  thickness: number;
  color: string;
  materialId: string | null;
}

/** Shared fields for wall-hosted openings (doors / windows). */
export interface Opening {
  id: string;
  wallId: string;
  /** Distance along the wall measured from wall.a, in meters. */
  offset: number;
  /** Opening width along the wall, in meters. */
  width: number;
  /** Opening height (door full height, window from sill), in meters. */
  height: number;
}

export interface Door extends Opening {
  kind: 'door';
  /** Swing direction hint: 0 = none, 1 = in, 2 = out. */
  swing: 0 | 1 | 2;
  /**
   * Walkthrough behaviour and anything else that is not geometry. Only
   * `doorBehavior` is read today (see `doorBehavior()`); the bag exists so a
   * future field does not need a schema migration.
   */
  metadata?: Record<string, unknown>;
}

/**
 * How a door behaves when someone walks up to it in the walkthrough.
 * `manual` waits for E, `automatic` opens on approach, `open` is a doorway
 * that never closes, `locked` never opens.
 */
export type DoorBehavior = 'manual' | 'automatic' | 'open' | 'locked';

export const DOOR_BEHAVIORS: DoorBehavior[] = ['manual', 'automatic', 'open', 'locked'];

export function doorBehavior(d: Door): DoorBehavior {
  const v = d.metadata?.doorBehavior;
  return typeof v === 'string' && (DOOR_BEHAVIORS as string[]).includes(v) ? (v as DoorBehavior) : 'manual';
}

export interface Window extends Opening {
  kind: 'window';
  /** Height from finished floor to the sill, in meters. */
  sill: number;
}

/** A closed room polygon (used for floor slabs and area measurements). */
export interface Room {
  id: string;
  name: string;
  points: Vec2[];
  color: string;
  materialId: string | null;
}

/** A furniture / catalog object instance placed on a floor. */
export interface ProjectObject {
  id: string;
  assetId: string;
  name: string;
  shape: string;
  /** Footprint center (meters). */
  x: number;
  z: number;
  /** Rotation around the vertical (Y) axis, radians. */
  rotation: number;
  /** Uniform scale. */
  scale: number;
  width: number;
  depth: number;
  height: number;
  color: string | null;
  materialId: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * A scanned or photographed paper sketch laid under the floor plan so it can
 * be traced. `src` is a data URL (the image travels with the project);
 * position and size are in plan metres, so the drawing stays aligned when the
 * project is reopened anywhere.
 */
export interface SketchUnderlay {
  src: string;
  /** Plan position of the image's top-left corner, metres. */
  x: number;
  y: number;
  /** Width in metres; height follows the image's aspect ratio. */
  width: number;
  /** Pixel aspect (height / width) of the source image. */
  aspect: number;
  /** Degrees, clockwise in plan. */
  rotation: number;
  /** 0..1 */
  opacity: number;
  visible: boolean;
  /** Locked underlays cannot be dragged in the plan. */
  locked: boolean;
  /** Also show it on the floor in the 3D view. */
  show3d: boolean;
}

export interface Floor {
  id: string;
  name: string;
  elevation: number;
  height: number;
  visible: boolean;
  walls: Wall[];
  doors: Door[];
  windows: Window[];
  rooms: Room[];
  objects: ProjectObject[];
  /** Optional traced-over paper sketch. */
  underlay?: SketchUnderlay | null;
}

/**
 * Where a walkthrough can start. Stored on the project (not in the runtime
 * state) because the designer chooses it and it travels with the design.
 * `yaw` is the heading in radians, using the 3D camera convention: 0 looks
 * north (towards -z on the plan), positive turns left.
 */
export interface SpawnPoint {
  id: string;
  name: string;
  floorId: string;
  x: number;
  z: number;
  yaw: number;
}

/** The only walkthrough data that belongs in the persistent model. */
export interface WalkthroughProjectSettings {
  spawns: SpawnPoint[];
  /** Which spawn the walkthrough starts from; null = the first one, or an automatic pick. */
  startSpawnId: string | null;
}

export interface Project {
  id: string;
  name: string;
  units: UnitSystem;
  floorHeight: number;
  floors: Floor[];
  updatedAt: number;
  /** Optional: absent on projects saved before the walkthrough existed. */
  walkthrough?: WalkthroughProjectSettings;
}

/** Helpers to build freshly-created model elements. */
export const createProject = (name = 'Untitled Project'): Project => ({
  id: 'project-' + Math.random().toString(36).slice(2, 10),
  name,
  units: 'meters',
  floorHeight: 3,
  floors: [createFloor()],
  updatedAt: Date.now(),
});

export const createFloor = (name = 'Ground Floor'): Floor => ({
  id: 'floor-' + Math.random().toString(36).slice(2, 10),
  name,
  elevation: 0,
  height: 3,
  visible: true,
  walls: [],
  doors: [],
  windows: [],
  rooms: [],
  objects: [],
});

export const createWall = (a: Vec2, b: Vec2, thickness = 0.15, height = 3): Wall => ({
  id: 'wall-' + Math.random().toString(36).slice(2, 10),
  a: { ...a },
  b: { ...b },
  thickness,
  height,
  color: '#e5e7eb',
  materialId: null,
});

export function wallLength(w: Wall): number {
  return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
}

/** Normalized direction vector from wall.a to wall.b. */
export function wallDir(w: Wall): Vec2 {
  const len = wallLength(w);
  if (len === 0) return { x: 1, y: 0 };
  return { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
}

/** Point on the wall's centreline at distance `t` from wall.a. */
export function pointOnWall(w: Wall, t: number): Vec2 {
  const d = wallDir(w);
  return { x: w.a.x + d.x * t, y: w.a.y + d.y * t };
}

export function floorById(p: Project, floorId: string): Floor | undefined {
  return p.floors.find((f) => f.id === floorId);
}

export function activeFloor(p: Project): Floor {
  return p.floors[0];
}

/** Clamped region of the wall that hosts openings (taps zero-length walls). */
export function wallOpenings(w: Wall, openings: Opening[]): Opening[] {
  const len = wallLength(w);
  if (len === 0) return [];
  return openings
    .filter((o) => o.wallId === w.id)
    .map((o) => ({ ...o, offset: Math.min(Math.max(o.offset, 0), Math.max(len - o.width, 0)) }));
}