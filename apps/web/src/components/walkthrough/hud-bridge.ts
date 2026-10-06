'use client';

import type { InputController } from './InputController';

/**
 * The HUD is ordinary DOM over the canvas; the rig lives inside the WebGL
 * tree. These few hooks let the HUD ask for pointer lock and feed on-screen
 * controls into the same input the keyboard uses.
 */
let lockHandler: (() => void) | null = null;
let input: InputController | null = null;

export function setLockHandler(fn: (() => void) | null): void {
  lockHandler = fn;
}

export function requestWalkLock(): void {
  lockHandler?.();
}

export function setInputController(i: InputController | null): void {
  input = i;
}

export function getInputController(): InputController | null {
  return input;
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
