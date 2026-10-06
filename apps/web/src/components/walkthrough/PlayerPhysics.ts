/**
 * Player motion: acceleration, friction, gravity, stepping and collision
 * response. Pure arithmetic on a plain state object, so it runs identically in
 * the browser's animation loop and in a Node test, and it never touches React.
 *
 * Coordinates are the 3D scene's: x east, z south (the plan's y), y up. Yaw 0
 * looks towards -z; positive yaw turns left.
 */

import type { BlockQuery, CollisionWorld, GroundHit } from './WalkthroughCollision';
import { groundAt, resolveHorizontal } from './WalkthroughCollision';
import type { StairRamp } from './StairController';
import { bodyOf, type WalkSettings } from './WalkSettings';

export interface PlayerState {
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  floorId: string | null;
  /** The flight currently underfoot, if any. */
  ramp: StairRamp | null;
  /** Horizontal speed, m/s (for head bob and the avatar). */
  speed: number;
  /** Seconds in the air; drives the "returned to safe position" rescue. */
  airTime: number;
}

export interface MoveInput {
  /** -1..1, +1 = forwards. */
  forward: number;
  /** -1..1, +1 = right. */
  strafe: number;
  sprint: boolean;
  slow: boolean;
  jump: boolean;
}

export const IDLE_INPUT: MoveInput = { forward: 0, strafe: 0, sprint: false, slow: false, jump: false };

export interface StepResult {
  /** Fell out of the world: caller should respawn. */
  fellOut: boolean;
  /** Touched ground this step after being airborne. */
  landed: boolean;
  floorChanged: boolean;
  /** Collider ids touched this step. */
  touched: string[];
}

export function createPlayer(x: number, y: number, z: number, yaw: number, floorId: string | null): PlayerState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, grounded: true, floorId, ramp: null, speed: 0, airTime: 0 };
}

export function forwardOf(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function rightOf(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

function moveToward(v: number, target: number, maxDelta: number): number {
  const d = target - v;
  if (Math.abs(d) <= maxDelta) return target;
  return v + Math.sign(d) * maxDelta;
}

const MAX_DT = 1 / 20;
const MAX_STEP_TRAVEL = 0.12;

/**
 * Advances the player by `dt` seconds. Long frames are split into sub-steps so
 * a stutter cannot carry the body through a wall, and the clamp means a tab
 * that was in the background does not fling the player across the house.
 */
export function stepPlayer(p: PlayerState, input: MoveInput, settings: WalkSettings, world: CollisionWorld, dt: number, q: BlockQuery): StepResult {
  const result: StepResult = { fellOut: false, landed: false, floorChanged: false, touched: [] };
  if (!(dt > 0)) return result;
  dt = Math.min(dt, MAX_DT);

  const body = bodyOf(settings);
  const before = p.floorId;

  // --- wanted horizontal velocity -------------------------------------------
  let fwd = Math.max(-1, Math.min(1, input.forward));
  let str = Math.max(-1, Math.min(1, input.strafe));
  const mag = Math.hypot(fwd, str);
  if (mag > 1) {
    fwd /= mag;
    str /= mag;
  }
  const wants = mag > 0.001;
  const top = input.slow ? settings.slowSpeed : input.sprint && settings.sprintEnabled ? settings.runSpeed : settings.walkSpeed;
  const f = forwardOf(p.yaw);
  const r = rightOf(p.yaw);
  const tx = (f.x * fwd + r.x * str) * top;
  const tz = (f.z * fwd + r.z * str) * top;

  // In the air you keep most of your momentum and steer only a little.
  const control = p.grounded ? 1 : 0.25;
  const accel = (wants ? settings.acceleration : settings.deceleration) * control;
  p.vx = moveToward(p.vx, tx, accel * dt);
  p.vz = moveToward(p.vz, tz, accel * dt);

  // --- jump -----------------------------------------------------------------
  if (input.jump && settings.jumpEnabled && p.grounded) {
    p.vy = Math.sqrt(2 * settings.gravity * settings.jumpHeight);
    p.grounded = false;
  }

  // --- integrate in sub-steps ---------------------------------------------
  const speed = Math.hypot(p.vx, p.vz);
  const steps = Math.max(1, Math.ceil((speed * dt) / MAX_STEP_TRAVEL));
  const h = dt / steps;
  const wasGrounded = p.grounded;

  for (let i = 0; i < steps; i++) {
    const nx = p.x + p.vx * h;
    const nz = p.z + p.vz * h;
    const res = resolveHorizontal(world, nx, nz, body, p.y, q);
    for (const id of res.touched) if (!result.touched.includes(id)) result.touched.push(id);
    p.x = res.x;
    p.z = res.z;

    // Gravity and ground snapping.
    p.vy -= settings.gravity * h;
    const ny = p.y + p.vy * h;
    const g: GroundHit | null = groundAt(world, p.x, p.z, Math.max(p.y, ny), body.stepUp);
    if (g && ny <= g.y + 1e-4) {
      // Landed, or stepping up a ledge no taller than stepUp.
      p.y = g.y;
      p.vy = 0;
      p.grounded = true;
      p.ramp = g.ramp ?? null;
      p.floorId = g.floorId;
    } else if (g && p.grounded && p.vy <= 0 && ny - g.y <= body.stepUp + 0.05) {
      // Walking down a ramp or off a shallow step: stay glued to the ground
      // instead of lofting into a tiny fall on every riser.
      p.y = g.y;
      p.vy = 0;
      p.ramp = g.ramp ?? null;
      p.floorId = g.floorId;
    } else {
      p.y = ny;
      p.grounded = false;
      p.ramp = null;
    }
  }

  // Rubbing along a wall bleeds speed; it should not read as a bounce.
  if (result.touched.length) {
    const after = resolveHorizontal(world, p.x + p.vx * 1e-3, p.z + p.vz * 1e-3, body, p.y, q, 1);
    if (after.pushed > 0) {
      const nx = (after.x - (p.x + p.vx * 1e-3)) / (after.pushed || 1);
      const nz = (after.z - (p.z + p.vz * 1e-3)) / (after.pushed || 1);
      const into = p.vx * nx + p.vz * nz;
      if (into < 0) {
        p.vx -= nx * into;
        p.vz -= nz * into;
      }
    }
  }

  p.speed = Math.hypot(p.vx, p.vz);
  p.airTime = p.grounded ? 0 : p.airTime + dt;
  result.landed = !wasGrounded && p.grounded;
  result.floorChanged = p.floorId !== before;
  result.fellOut = p.y < world.bounds.minY - 6 || p.airTime > 6;
  return result;
}

/** Puts the player on the ground at a spot, with no momentum. */
export function placePlayer(p: PlayerState, world: CollisionWorld, x: number, y: number, z: number, yaw: number, stepUp: number): void {
  p.x = x;
  p.z = z;
  p.vx = p.vy = p.vz = 0;
  p.yaw = yaw;
  p.pitch = 0;
  const g = groundAt(world, x, z, y + 0.3, stepUp + 0.3);
  p.y = g ? g.y : y;
  p.grounded = !!g;
  p.ramp = g?.ramp ?? null;
  p.floorId = g?.floorId ?? p.floorId;
  p.speed = 0;
  p.airTime = 0;
}
