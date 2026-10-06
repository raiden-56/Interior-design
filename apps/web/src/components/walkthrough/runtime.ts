'use client';

import type { WalkthroughRuntime } from './PlayerController';

/**
 * Tiny registry so the HUD (plain DOM, outside the WebGL tree) can reach the
 * live runtime without threading it through props or putting a class instance
 * in a store.
 */
let current: WalkthroughRuntime | null = null;
const listeners = new Set<() => void>();

export function setRuntime(r: WalkthroughRuntime | null): void {
  current = r;
  for (const l of listeners) l();
}

export function getRuntime(): WalkthroughRuntime | null {
  return current;
}

export function onRuntimeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
