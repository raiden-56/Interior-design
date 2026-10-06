/**
 * Everything about how the walkthrough *feels*, in one place.
 *
 * Speeds, heights and accelerations are never written into the controllers
 * directly: they read whatever is in here, so a designer who finds the default
 * pace too brisk changes one number and every system agrees. Settings persist
 * per browser, not per project — they describe the person, not the design.
 */

export type HeadBob = 'off' | 'low' | 'medium';
export type WalkLighting = 'day' | 'evening' | 'night';
export type CameraMode = 'first' | 'third' | 'free';

export interface WalkSettings {
  /** Metres per second. Real people stroll at about 1.4. */
  walkSpeed: number;
  runSpeed: number;
  /** Ctrl / Alt held: for lining up a view or squeezing past furniture. */
  slowSpeed: number;
  /** m/s² towards the wanted velocity while a key is down. */
  acceleration: number;
  /** m/s² back to rest once the keys are released. */
  deceleration: number;
  jumpHeight: number;
  /** Off by default — this is a design tool, not a platformer. */
  jumpEnabled: boolean;
  sprintEnabled: boolean;
  /** Total standing height of the capsule, metres. */
  playerHeight: number;
  /** Camera height above the feet when standing. */
  eyeHeight: number;
  /** Capsule radius: how close you can get to a wall. */
  radius: number;
  /** Tallest ledge the feet climb without a jump — one domestic stair riser plus a margin. */
  stepHeight: number;
  gravity: number;
  /** Multiplier on the base look rate. */
  mouseSensitivity: number;
  invertY: boolean;
  headBob: HeadBob;
  /** 0 = raw, 1 = heavily filtered look and height changes. */
  cameraSmoothing: number;
  /** Disables bob, shortens transitions, removes the fade on floor jumps. */
  reducedMotion: boolean;
  /** Vertical field of view in degrees while walking. */
  fov: number;
  highContrastPrompts: boolean;
  /** Treat every manual door as automatic. Per-door behaviour still wins for `open` and `locked`. */
  autoDoors: boolean;
  showHints: boolean;
}

export const DEFAULT_WALK_SETTINGS: WalkSettings = {
  walkSpeed: 1.4,
  runSpeed: 3.2,
  slowSpeed: 0.7,
  acceleration: 10,
  deceleration: 14,
  jumpHeight: 0.35,
  jumpEnabled: false,
  sprintEnabled: true,
  playerHeight: 1.75,
  eyeHeight: 1.65,
  radius: 0.28,
  stepHeight: 0.32,
  gravity: 9.81,
  mouseSensitivity: 1,
  invertY: false,
  headBob: 'low',
  cameraSmoothing: 0.35,
  reducedMotion: false,
  fov: 72,
  highContrastPrompts: false,
  autoDoors: false,
  showHints: true,
};

export const WALK_SETTINGS_KEY = 'interior.walkthrough.settings.v1';

/** Clamps a partial, possibly stale or hand-edited, settings object into a valid one. */
export function normalizeWalkSettings(input: Partial<WalkSettings> | null | undefined): WalkSettings {
  const s: WalkSettings = { ...DEFAULT_WALK_SETTINGS, ...(input ?? {}) };
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback;
  s.walkSpeed = num(s.walkSpeed, 0.5, 3, DEFAULT_WALK_SETTINGS.walkSpeed);
  s.runSpeed = num(s.runSpeed, s.walkSpeed, 6, DEFAULT_WALK_SETTINGS.runSpeed);
  s.slowSpeed = num(s.slowSpeed, 0.2, s.walkSpeed, DEFAULT_WALK_SETTINGS.slowSpeed);
  s.acceleration = num(s.acceleration, 2, 40, DEFAULT_WALK_SETTINGS.acceleration);
  s.deceleration = num(s.deceleration, 2, 60, DEFAULT_WALK_SETTINGS.deceleration);
  s.jumpHeight = num(s.jumpHeight, 0.1, 1, DEFAULT_WALK_SETTINGS.jumpHeight);
  s.playerHeight = num(s.playerHeight, 1.2, 2.2, DEFAULT_WALK_SETTINGS.playerHeight);
  s.eyeHeight = num(s.eyeHeight, 1.0, s.playerHeight, Math.min(DEFAULT_WALK_SETTINGS.eyeHeight, s.playerHeight - 0.08));
  s.radius = num(s.radius, 0.15, 0.5, DEFAULT_WALK_SETTINGS.radius);
  s.stepHeight = num(s.stepHeight, 0.1, 0.6, DEFAULT_WALK_SETTINGS.stepHeight);
  s.gravity = num(s.gravity, 1, 30, DEFAULT_WALK_SETTINGS.gravity);
  s.mouseSensitivity = num(s.mouseSensitivity, 0.2, 3, DEFAULT_WALK_SETTINGS.mouseSensitivity);
  s.cameraSmoothing = num(s.cameraSmoothing, 0, 1, DEFAULT_WALK_SETTINGS.cameraSmoothing);
  s.fov = num(s.fov, 50, 100, DEFAULT_WALK_SETTINGS.fov);
  if (!['off', 'low', 'medium'].includes(s.headBob)) s.headBob = 'low';
  return s;
}

export function loadWalkSettings(): WalkSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_WALK_SETTINGS };
    const raw = localStorage.getItem(WALK_SETTINGS_KEY);
    return normalizeWalkSettings(raw ? (JSON.parse(raw) as Partial<WalkSettings>) : null);
  } catch {
    return { ...DEFAULT_WALK_SETTINGS };
  }
}

export function saveWalkSettings(s: WalkSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(WALK_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Private mode or a full quota: the settings simply do not persist.
  }
}

/** Metres of camera bob at full walking speed, per setting. */
export function headBobAmplitude(s: WalkSettings): number {
  if (s.reducedMotion) return 0;
  return s.headBob === 'medium' ? 0.035 : s.headBob === 'low' ? 0.018 : 0;
}

/** Radians of yaw per pixel of mouse travel. */
export function lookRate(s: WalkSettings): number {
  return 0.0021 * s.mouseSensitivity;
}

/** The three body numbers every collision query needs. */
export interface BodyDims {
  radius: number;
  height: number;
  stepUp: number;
}

export const bodyOf = (s: WalkSettings): BodyDims => ({ radius: s.radius, height: s.playerHeight, stepUp: s.stepHeight });
