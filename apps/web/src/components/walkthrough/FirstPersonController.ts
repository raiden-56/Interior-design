/**
 * First-person camera: the eye sits on the player's head, looks where the
 * mouse points, and is smoothed so a stair riser or a step up onto a landing
 * reads as a glide rather than a jolt.
 */

import * as THREE from 'three';
import type { PlayerState } from './PlayerPhysics';
import type { Pose } from './SittingController';
import { HeadBobber, damp, quaternionFromYawPitch } from './WalkthroughCamera';
import { headBobAmplitude, type WalkSettings } from './WalkSettings';

export const MAX_PITCH = (85 * Math.PI) / 180;

export class FirstPersonController {
  private bob = new HeadBobber();
  private eyeY: number | null = null;
  private yaw: number | null = null;
  private pitch: number | null = null;
  private quat = new THREE.Quaternion();

  /** The pose actually shown this frame (after smoothing). */
  readonly shown: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  reset(): void {
    this.bob.reset();
    this.eyeY = null;
    this.yaw = null;
    this.pitch = null;
  }

  /**
   * Positions the camera for a standing player, or for an explicit eye pose
   * while sitting / standing up / in a lift.
   */
  update(camera: THREE.Camera, player: PlayerState, override: Pose | null, settings: WalkSettings, dt: number): void {
    const targetPose: Pose = override ?? { x: player.x, y: player.y + settings.eyeHeight, z: player.z, yaw: player.yaw, pitch: player.pitch };

    // Vertical smoothing hides the stepping of the ground function; it is
    // lighter when the body is in the air so a fall still feels like one.
    const lambda = player.grounded && !override ? 14 - settings.cameraSmoothing * 6 : 40;
    this.eyeY = this.eyeY === null || Math.abs(this.eyeY - targetPose.y) > 2.5 ? targetPose.y : damp(this.eyeY, targetPose.y, lambda, dt);

    // Look smoothing is optional and mild: too much and the view lags the hand.
    const look = settings.cameraSmoothing > 0.02 ? 60 - settings.cameraSmoothing * 38 : 0;
    this.yaw = this.yaw === null || look === 0 ? targetPose.yaw : damp(this.yaw, targetPose.yaw, look, dt);
    this.pitch = this.pitch === null || look === 0 ? targetPose.pitch : damp(this.pitch, targetPose.pitch, look, dt);

    const bobbing = !override && player.grounded;
    this.bob.update(dt, bobbing ? player.speed : 0, bobbing, headBobAmplitude(settings));
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    this.shown.x = targetPose.x + rx * this.bob.x;
    this.shown.y = this.eyeY + this.bob.y;
    this.shown.z = targetPose.z + rz * this.bob.x;
    this.shown.yaw = this.yaw;
    this.shown.pitch = this.pitch;

    camera.position.set(this.shown.x, this.shown.y, this.shown.z);
    camera.quaternion.copy(quaternionFromYawPitch(this.yaw, this.pitch, this.quat));
  }
}

/** Applies a look delta to a yaw/pitch pair, clamping pitch so the view never flips or rolls. */
export function applyLook(target: { yaw: number; pitch: number }, dx: number, dy: number, rate: number, invertY: boolean): void {
  target.yaw -= dx * rate;
  target.pitch += (invertY ? 1 : -1) * dy * rate;
  if (target.pitch > MAX_PITCH) target.pitch = MAX_PITCH;
  if (target.pitch < -MAX_PITCH) target.pitch = -MAX_PITCH;
  // Keep yaw bounded so it never loses precision after a long session.
  if (target.yaw > Math.PI * 4 || target.yaw < -Math.PI * 4) target.yaw = ((target.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
}
