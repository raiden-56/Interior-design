/**
 * Sitting and lying down.
 *
 * The transition is a short eased move of the *camera* pose — position, eye
 * height and heading — never a teleport. While seated the body is parked on
 * the seat and only the head turns; standing up looks for a free patch of
 * floor first, so you cannot stand up into the coffee table.
 */

import type { ProjectObject } from '@interior/core';
import type { PlayerState } from './PlayerPhysics';
import { forwardOf } from './PlayerPhysics';
import { worldSeats, type WorldSeat } from './FurnitureInteraction';
import { groundAt, isStandable, pathBlocked, type BlockQuery, type CollisionWorld } from './WalkthroughCollision';
import { bodyOf, type WalkSettings } from './WalkSettings';

export type SitPhase = 'standing' | 'sitting-down' | 'seated' | 'standing-up';
export type SitKind = 'sit' | 'lie';

/** A camera pose: where the eye is and where it looks. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface SitState {
  phase: SitPhase;
  kind: SitKind;
  objectId: string | null;
  objectName: string;
  seatIndex: number;
  seat: WorldSeat | null;
  from: Pose;
  to: Pose;
  t: number;
  duration: number;
  /** Where the body stood before sitting; the first candidate when standing up. */
  stoodAt: { x: number; y: number; z: number; yaw: number } | null;
}

/** Eye height above the seat surface when sitting upright / lying down. */
export const SIT_EYE_ABOVE_SEAT = 0.78;
export const LIE_EYE_ABOVE_SEAT = 0.28;
export const SIT_SECONDS = 0.42;

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const idlePose = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });

export class SittingController {
  state: SitState = {
    phase: 'standing',
    kind: 'sit',
    objectId: null,
    objectName: '',
    seatIndex: -1,
    seat: null,
    from: idlePose(),
    to: idlePose(),
    t: 0,
    duration: SIT_SECONDS,
    stoodAt: null,
  };

  get seated(): boolean {
    return this.state.phase === 'seated';
  }

  /** True during a transition, when input is ignored. */
  get busy(): boolean {
    return this.state.phase === 'sitting-down' || this.state.phase === 'standing-up';
  }

  get active(): boolean {
    return this.state.phase !== 'standing';
  }

  /** The eye pose the player would have standing where they are now. */
  static standingPose(p: PlayerState, settings: WalkSettings): Pose {
    return { x: p.x, y: p.y + settings.eyeHeight, z: p.z, yaw: p.yaw, pitch: p.pitch };
  }

  /**
   * Picks the nearest seat of `obj` and starts the sit-down move. Fails when
   * the object has no seats or the seat is unreasonably far away.
   */
  trySit(obj: ProjectObject, elevation: number, kind: SitKind, p: PlayerState, settings: WalkSettings): { ok: boolean; reason?: string } {
    if (this.active) return { ok: false, reason: 'busy' };
    const seats = worldSeats(obj, elevation);
    if (!seats.length) return { ok: false, reason: 'no seats' };
    let best = seats[0];
    let bestD = Infinity;
    for (const s of seats) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    if (bestD > 3.5) return { ok: false, reason: 'too far' };
    const from = SittingController.standingPose(p, settings);
    const eye = best.y + (kind === 'lie' ? LIE_EYE_ABOVE_SEAT : SIT_EYE_ABOVE_SEAT);
    const to: Pose = { x: best.x, y: eye, z: best.z, yaw: nearestYaw(p.yaw, best.yaw), pitch: kind === 'lie' ? 0.35 : 0 };
    this.state = {
      phase: 'sitting-down',
      kind,
      objectId: obj.id,
      objectName: obj.name,
      seatIndex: best.index,
      seat: best,
      from,
      to,
      t: 0,
      duration: settings.reducedMotion ? 0.18 : SIT_SECONDS,
      stoodAt: { x: p.x, y: p.y, z: p.z, yaw: p.yaw },
    };
    return { ok: true };
  }

  /**
   * Stands the player up on the nearest free patch of floor. The spot they
   * sat down from is tried first (it was standable a moment ago), then in
   * front of the seat, then around it.
   */
  tryStand(world: CollisionWorld, p: PlayerState, settings: WalkSettings, q: BlockQuery): { ok: boolean; reason?: string } {
    if (this.state.phase !== 'seated' || !this.state.seat) return { ok: false, reason: 'not seated' };
    const body = bodyOf(settings);
    const seat = this.state.seat;
    const candidates: { x: number; z: number }[] = [];
    if (this.state.stoodAt) candidates.push(this.state.stoodAt);
    const f = forwardOf(seat.yaw);
    for (const dist of [0.75, 1.0, 1.3]) candidates.push({ x: seat.x + f.x * dist, z: seat.z + f.z * dist });
    for (const dist of [0.8, 1.2]) {
      candidates.push({ x: seat.x - f.z * dist, z: seat.z + f.x * dist });
      candidates.push({ x: seat.x + f.z * dist, z: seat.z - f.x * dist });
      candidates.push({ x: seat.x - f.x * dist, z: seat.z - f.z * dist });
    }
    const floorY = seat.y - 0.2;
    // The seat itself is solid again the moment you leave it, and a spot on
    // the far side of a wall is not a way out of a chair.
    const strict: BlockQuery = { doorBlocks: q.doorBlocks, ignoreObjectId: null };
    let spot: { x: number; y: number; z: number } | null = null;
    for (const c of candidates) {
      const g = groundAt(world, c.x, c.z, floorY + 0.3, body.stepUp + 0.3);
      if (!g || Math.abs(g.y - floorY) > 0.8) continue;
      if (pathBlocked(world, seat.x, seat.z, c.x, c.z, g.y, strict)) continue;
      if (isStandable(world, c.x, c.z, g.y, body, strict)) {
        spot = { x: c.x, y: g.y, z: c.z };
        break;
      }
    }
    if (!spot) return { ok: false, reason: 'no room to stand' };
    const from = this.currentPose() ?? this.state.to;
    const to: Pose = { x: spot.x, y: spot.y + settings.eyeHeight, z: spot.z, yaw: from.yaw, pitch: Math.max(from.pitch, -0.2) };
    this.state = { ...this.state, phase: 'standing-up', from, to, t: 0, duration: settings.reducedMotion ? 0.18 : SIT_SECONDS, stoodAt: { ...spot, yaw: from.yaw } };
    return { ok: true };
  }

  /** Free look while seated: the head turns, the body stays. */
  look(dyaw: number, dpitch: number, maxPitch: number): void {
    if (this.state.phase !== 'seated') return;
    this.state.to.yaw += dyaw;
    this.state.to.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.state.to.pitch + dpitch));
  }

  /**
   * Advances a transition. Returns the pose the camera should take this frame
   * (null when standing normally), and reports when a transition completed so
   * the caller can move the body.
   */
  update(dt: number): { pose: Pose | null; finished: 'seated' | 'standing' | null } {
    const s = this.state;
    if (s.phase === 'standing') return { pose: null, finished: null };
    if (s.phase === 'seated') return { pose: s.to, finished: null };
    s.t = Math.min(1, s.t + dt / Math.max(s.duration, 1e-3));
    const pose = this.currentPose()!;
    if (s.t >= 1) {
      if (s.phase === 'sitting-down') {
        s.phase = 'seated';
        return { pose: s.to, finished: 'seated' };
      }
      const stood = s.stoodAt;
      this.state = { ...s, phase: 'standing', objectId: null, seat: null, seatIndex: -1 };
      this.state.stoodAt = stood;
      return { pose, finished: 'standing' };
    }
    return { pose, finished: null };
  }

  currentPose(): Pose | null {
    const s = this.state;
    if (s.phase === 'standing') return null;
    if (s.phase === 'seated') return s.to;
    const k = easeInOut(s.t);
    return {
      x: s.from.x + (s.to.x - s.from.x) * k,
      y: s.from.y + (s.to.y - s.from.y) * k,
      z: s.from.z + (s.to.z - s.from.z) * k,
      yaw: s.from.yaw + (s.to.yaw - s.from.yaw) * k,
      pitch: s.from.pitch + (s.to.pitch - s.from.pitch) * k,
    };
  }

  /** Where the feet end up after the last completed stand-up. */
  lastStandingSpot(): { x: number; y: number; z: number; yaw: number } | null {
    return this.state.stoodAt;
  }

  reset(): void {
    this.state = { ...this.state, phase: 'standing', objectId: null, seat: null, seatIndex: -1, t: 0 };
  }
}

/** The target yaw expressed within half a turn of the current one, so the body turns the short way. */
export function nearestYaw(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  let d = (to - from) % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d < -Math.PI) d += twoPi;
  return from + d;
}
