/**
 * Camera arithmetic for the walkthrough: eased flights in and out of the
 * mode, saving and restoring the editor camera exactly, head bob, and the
 * smoothing that keeps a stair climb from feeling like a staircase of camera
 * jumps.
 */

import * as THREE from 'three';
import type { Pose } from './SittingController';

export interface CameraMemento {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** OrbitControls target, when the editor camera had one. */
  target: THREE.Vector3 | null;
  fov: number;
  zoom: number;
  near: number;
}

/** Snapshot of the editor camera, taken before the walkthrough takes over. */
export function captureCamera(camera: THREE.PerspectiveCamera, controls: { target: THREE.Vector3 } | null): CameraMemento {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    target: controls ? controls.target.clone() : null,
    fov: camera.fov,
    zoom: camera.zoom,
    near: camera.near,
  };
}

/** Puts the camera (and its orbit target) back exactly where the memento was taken. */
export function restoreCamera(camera: THREE.PerspectiveCamera, controls: { target: THREE.Vector3; update: () => void } | null, m: CameraMemento): void {
  camera.position.copy(m.position);
  camera.quaternion.copy(m.quaternion);
  camera.fov = m.fov;
  camera.zoom = m.zoom;
  camera.near = m.near;
  camera.updateProjectionMatrix();
  if (controls && m.target) {
    controls.target.copy(m.target);
    controls.update();
  }
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface CameraPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
}

/** Eased flight between two camera poses, including the field of view. */
export class PoseTween {
  private from: CameraPose | null = null;
  private to: CameraPose | null = null;
  private start = 0;
  private duration = 1;
  private tmpPos = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();

  get running(): boolean {
    return this.from !== null;
  }

  begin(from: CameraPose, to: CameraPose, durationMs: number, now = performance.now()): void {
    this.from = { position: from.position.clone(), quaternion: from.quaternion.clone(), fov: from.fov };
    this.to = { position: to.position.clone(), quaternion: to.quaternion.clone(), fov: to.fov };
    this.start = now;
    this.duration = Math.max(1, durationMs);
  }

  /** Applies the interpolated pose to the camera; returns true once finished. */
  apply(camera: THREE.PerspectiveCamera, now = performance.now()): boolean {
    if (!this.from || !this.to) return true;
    const k = Math.min(1, (now - this.start) / this.duration);
    const e = easeInOutCubic(k);
    this.tmpPos.lerpVectors(this.from.position, this.to.position, e);
    this.tmpQuat.slerpQuaternions(this.from.quaternion, this.to.quaternion, e);
    camera.position.copy(this.tmpPos);
    camera.quaternion.copy(this.tmpQuat);
    const fov = this.from.fov + (this.to.fov - this.from.fov) * e;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (k >= 1) {
      this.from = this.to = null;
      return true;
    }
    return false;
  }

  cancel(): void {
    this.from = this.to = null;
  }
}

const EULER_ORDER = 'YXZ';

/** Quaternion for a yaw/pitch pair in the walkthrough's convention. */
export function quaternionFromYawPitch(yaw: number, pitch: number, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromEuler(new THREE.Euler(pitch, yaw, 0, EULER_ORDER));
}

/** The camera pose for an eye pose. */
export function cameraPoseFor(pose: Pose, fov: number): CameraPose {
  return { position: new THREE.Vector3(pose.x, pose.y, pose.z), quaternion: quaternionFromYawPitch(pose.yaw, pose.pitch), fov };
}

/** Yaw/pitch of an existing camera orientation (so a flight can start from where the editor camera looks). */
export function yawPitchOf(camera: THREE.Camera): { yaw: number; pitch: number } {
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, EULER_ORDER);
  return { yaw: e.y, pitch: e.x };
}

/** Exponential smoothing that is frame-rate independent. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/**
 * Subtle vertical and lateral bob that follows the walking cadence. Fades
 * with speed so a slow step barely moves and stops entirely in the air.
 */
export class HeadBobber {
  private phase = 0;
  private weight = 0;
  x = 0;
  y = 0;

  update(dt: number, speed: number, grounded: boolean, amplitude: number): void {
    const target = grounded && speed > 0.15 && amplitude > 0 ? Math.min(1, speed / 1.4) : 0;
    this.weight = damp(this.weight, target, 8, dt);
    if (this.weight > 0.001) {
      // ~1.9 steps per second at walking pace, scaling with speed.
      this.phase += dt * Math.PI * 2 * (0.9 + speed * 0.75);
    }
    const a = amplitude * this.weight * (0.7 + 0.3 * Math.min(speed / 3, 1));
    this.y = Math.sin(this.phase * 2) * a;
    this.x = Math.cos(this.phase) * a * 0.55;
  }

  reset(): void {
    this.phase = 0;
    this.weight = 0;
    this.x = this.y = 0;
  }
}

/** Camera position for a third-person boom behind an eye pose. */
export function thirdPersonBoom(eye: Pose, distance: number, lift: number): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
  const fx = -Math.sin(eye.yaw) * Math.cos(eye.pitch);
  const fz = -Math.cos(eye.yaw) * Math.cos(eye.pitch);
  const fy = Math.sin(eye.pitch);
  const position = new THREE.Vector3(eye.x - fx * distance, eye.y - fy * distance + lift, eye.z - fz * distance);
  const lookAt = new THREE.Vector3(eye.x + fx * 1.5, eye.y + fy * 1.5, eye.z + fz * 1.5);
  return { position, lookAt };
}
