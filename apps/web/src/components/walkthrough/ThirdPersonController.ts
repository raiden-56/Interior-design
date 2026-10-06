/**
 * Third-person camera: a boom behind the avatar that pulls in when a wall is
 * in the way, plus the avatar's own heading, which turns towards where the
 * body is moving rather than where the head looks.
 */

import * as THREE from 'three';
import type { PlayerState } from './PlayerPhysics';
import type { Pose } from './SittingController';
import { damp, thirdPersonBoom } from './WalkthroughCamera';
import { nearestYaw } from './SittingController';

export const THIRD_PERSON_DISTANCE = 2.8;
export const THIRD_PERSON_LIFT = 0.45;

export class ThirdPersonController {
  private distance = THIRD_PERSON_DISTANCE;
  private ray = new THREE.Raycaster();
  private dir = new THREE.Vector3();
  /** Smoothed heading of the avatar body. */
  bodyYaw = 0;

  reset(yaw = 0): void {
    this.distance = THIRD_PERSON_DISTANCE;
    this.bodyYaw = yaw;
  }

  update(camera: THREE.Camera, eye: Pose, player: PlayerState, obstacles: THREE.Object3D | null, dt: number): void {
    const boom = thirdPersonBoom(eye, THIRD_PERSON_DISTANCE, THIRD_PERSON_LIFT);

    // Shorten the boom when something solid sits between the head and the camera.
    let wanted = THIRD_PERSON_DISTANCE;
    if (obstacles) {
      const origin = new THREE.Vector3(eye.x, eye.y, eye.z);
      this.dir.copy(boom.position).sub(origin);
      const full = this.dir.length();
      this.dir.normalize();
      this.ray.set(origin, this.dir);
      this.ray.far = full;
      const hit = this.ray.intersectObject(obstacles, true).find((h) => !h.object.userData.walkthroughHelper && !h.object.userData.ceiling);
      if (hit) wanted = Math.max(0.5, hit.distance - 0.25);
    }
    this.distance = damp(this.distance, wanted, wanted < this.distance ? 30 : 6, dt);

    const k = this.distance / THIRD_PERSON_DISTANCE;
    const origin = new THREE.Vector3(eye.x, eye.y, eye.z);
    camera.position.copy(origin).lerp(boom.position, k);
    camera.lookAt(boom.lookAt);

    // The avatar faces its direction of travel; standing still, it keeps looking where the head looks.
    const moving = player.speed > 0.3;
    const target = moving ? Math.atan2(-player.vx, -player.vz) : eye.yaw;
    this.bodyYaw = damp(this.bodyYaw, nearestYaw(this.bodyYaw, target), moving ? 10 : 4, dt);
  }
}
