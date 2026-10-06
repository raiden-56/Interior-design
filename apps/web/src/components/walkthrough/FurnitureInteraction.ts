/**
 * What a piece of furniture does when you walk up to it.
 *
 * Defaults come from the catalog shape, so every sofa is sittable and every
 * wardrobe opens without anyone tagging them. A project object can override
 * any of it through `metadata` — the same bag that already carries `mounted` —
 * which keeps the canonical model as the only place these facts live:
 *
 *   metadata.collisionEnabled: false       // walk straight through it
 *   metadata.interaction: { type: 'sit' }  // or 'none' to make it inert
 *   metadata.interaction.seatPositions: [{ x, z, y, facing: { x, z } }]  // object-local, metres
 */

import type { ProjectObject } from '@interior/core';
import { isMounted } from '@interior/core';

export type InteractionType =
  | 'door'
  | 'sit'
  | 'lie'
  | 'cabinet'
  | 'drawer'
  | 'light'
  | 'switch'
  | 'window'
  | 'elevator'
  | 'stairs'
  | 'view'
  | 'inspect'
  | 'object'
  | 'none';

export const INTERACTION_TYPES: InteractionType[] = [
  'sit',
  'lie',
  'cabinet',
  'drawer',
  'light',
  'switch',
  'view',
  'inspect',
  'elevator',
  'stairs',
  'none',
];

const SIT_SHAPES = new Set(['sofa', 'lsofa', 'armchair', 'recliner', 'ottoman', 'chair', 'stool', 'bench', 'office-chair']);
const LIE_SHAPES = new Set(['bed']);
const CABINET_SHAPES = new Set([
  'cabinet',
  'wardrobe',
  'dresser',
  'nightstand',
  'shelf',
  'shoe-rack',
  'dressing-table',
  'pooja-unit',
  'kitchen-island',
  'kitchen-sink',
]);
const DRAWER_SHAPES = new Set(['refrigerator', 'dishwasher', 'washing-machine', 'oven', 'microwave', 'desk']);
const LIGHT_SHAPES = new Set(['floor-lamp', 'table-lamp', 'pendant']);
const SWITCH_SHAPES = new Set(['ceiling-fan', 'ac-split', 'water-heater', 'hood']);
const VIEW_SHAPES = new Set(['tv', 'tv-unit', 'mirror']);
const INERT_SHAPES = new Set(['rug', 'curtain']);

export function defaultInteraction(shape: string): InteractionType {
  if (SIT_SHAPES.has(shape)) return 'sit';
  if (LIE_SHAPES.has(shape)) return 'lie';
  if (CABINET_SHAPES.has(shape)) return 'cabinet';
  if (DRAWER_SHAPES.has(shape)) return 'drawer';
  if (LIGHT_SHAPES.has(shape)) return 'light';
  if (SWITCH_SHAPES.has(shape)) return 'switch';
  if (VIEW_SHAPES.has(shape)) return 'view';
  if (shape === 'stairs') return 'stairs';
  if (shape === 'elevator') return 'elevator';
  if (INERT_SHAPES.has(shape)) return 'none';
  return 'inspect';
}

export interface InteractionSpec {
  type: InteractionType;
  /** Custom verb for the prompt, e.g. "Water the plant". */
  prompt?: string;
  /** From metadata; replaces the shape-derived seats. */
  seatPositions?: Seat[];
}

/** A place to sit, in the object's own frame (already scaled). */
export interface Seat {
  x: number;
  z: number;
  /** Height of the seat surface above the object's floor. */
  y: number;
  /** Unit direction the sitter faces, object-local. */
  facing: { x: number; z: number };
}

export function interactionOf(o: ProjectObject): InteractionSpec {
  const raw = o.metadata?.interaction as Partial<InteractionSpec> | undefined;
  const type = raw && typeof raw.type === 'string' && (INTERACTION_TYPES as string[]).includes(raw.type)
    ? (raw.type as InteractionType)
    : defaultInteraction(o.shape);
  const seats = Array.isArray(raw?.seatPositions)
    ? raw!.seatPositions.filter(
        (s): s is Seat =>
          !!s &&
          typeof s.x === 'number' &&
          typeof s.z === 'number' &&
          typeof s.y === 'number' &&
          !!s.facing &&
          typeof s.facing.x === 'number' &&
          typeof s.facing.z === 'number',
      )
    : undefined;
  return { type, prompt: typeof raw?.prompt === 'string' ? raw.prompt : undefined, seatPositions: seats };
}

/** Whether `metadata.interaction` was set explicitly (vs. the shape default). */
export function hasExplicitInteraction(o: ProjectObject): boolean {
  return typeof (o.metadata?.interaction as { type?: unknown } | undefined)?.type === 'string';
}

/**
 * Whether the player bumps into this object. Rugs, curtains and anything that
 * hangs from a wall or ceiling never do; stairs are walked on, not into.
 */
export function collisionEnabled(o: ProjectObject): boolean {
  const flag = o.metadata?.collisionEnabled;
  if (typeof flag === 'boolean') return flag;
  if (isMounted(o)) return false;
  if (o.shape === 'rug' || o.shape === 'curtain' || o.shape === 'stairs') return false;
  return true;
}

/** Whether the collision flag was set explicitly on this object. */
export function hasExplicitCollision(o: ProjectObject): boolean {
  return typeof o.metadata?.collisionEnabled === 'boolean';
}

/**
 * Seat positions derived from the procedural shape. Heights follow the real
 * sitting posture people expect rather than the low-poly cushion geometry:
 * a sofa seat at ~0.42 m, a dining chair at ~0.45 m, a bed at mattress height.
 */
export function seatPositions(o: ProjectObject): Seat[] {
  const explicit = interactionOf(o).seatPositions;
  if (explicit && explicit.length) return explicit;
  const w = o.width * o.scale;
  const d = o.depth * o.scale;
  const h = o.height * o.scale;
  const front = { x: 0, z: 1 };
  switch (o.shape) {
    case 'sofa': {
      const n = Math.max(1, Math.round(w / 0.62));
      const seats: Seat[] = [];
      for (let i = 0; i < n; i++) seats.push({ x: -w / 2 + ((i + 0.5) * w) / n, z: d * 0.08, y: Math.min(0.44, h * 0.52), facing: front });
      return seats;
    }
    case 'lsofa': {
      const seats: Seat[] = [];
      const long = w;
      const short = d * 0.55;
      const n = Math.max(1, Math.round((long - short) / 0.62));
      for (let i = 0; i < n; i++) seats.push({ x: -long / 2 + short + ((i + 0.5) * (long - short)) / n, z: 0, y: Math.min(0.44, h * 0.52), facing: front });
      // The chaise faces across the sofa.
      seats.push({ x: -long / 2 + short / 2, z: d / 2 - short / 2, y: Math.min(0.44, h * 0.52), facing: { x: 1, z: 0 } });
      return seats;
    }
    case 'bench': {
      const n = Math.max(1, Math.round(w / 0.55));
      const seats: Seat[] = [];
      for (let i = 0; i < n; i++) seats.push({ x: -w / 2 + ((i + 0.5) * w) / n, z: 0, y: Math.min(0.46, h * 0.95), facing: front });
      return seats;
    }
    case 'chair':
    case 'office-chair':
      return [{ x: 0, z: 0.02, y: Math.min(0.46, h * 0.5), facing: front }];
    case 'stool':
      return [{ x: 0, z: 0, y: Math.min(0.72, h * 0.95), facing: front }];
    case 'armchair':
    case 'recliner':
      return [{ x: 0, z: d * 0.1, y: Math.min(0.44, h * 0.5), facing: front }];
    case 'ottoman':
      return [{ x: 0, z: 0, y: Math.min(0.42, h * 0.95), facing: front }];
    case 'bed':
      // Lying down: head towards the headboard (−x), looking across the room.
      return [{ x: w * 0.15, z: 0, y: Math.min(0.7, h * 0.75), facing: { x: 1, z: 0 } }];
    default:
      return [];
  }
}

/** Camera yaw that looks along a world direction (x, z), in the walkthrough's convention. */
export function yawFromDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export interface WorldSeat {
  index: number;
  x: number;
  z: number;
  /** Absolute seat height. */
  y: number;
  yaw: number;
}

/** Seats of an object placed in the world, on a floor at `elevation`. */
export function worldSeats(o: ProjectObject, elevation: number): WorldSeat[] {
  const c = Math.cos(o.rotation);
  const s = Math.sin(o.rotation);
  return seatPositions(o).map((seat, index) => {
    const x = o.x + seat.x * c - seat.z * s;
    const z = o.z + seat.x * s + seat.z * c;
    const fx = seat.facing.x * c - seat.facing.z * s;
    const fz = seat.facing.x * s + seat.facing.z * c;
    return { index, x, z, y: elevation + seat.y, yaw: yawFromDirection(fx, fz) };
  });
}

export const PROMPT_VERBS: Record<InteractionType, { open: string; close?: string }> = {
  door: { open: 'Open door', close: 'Close door' },
  sit: { open: 'Sit', close: 'Stand up' },
  lie: { open: 'Lie down', close: 'Get up' },
  cabinet: { open: 'Open', close: 'Close' },
  drawer: { open: 'Open', close: 'Close' },
  light: { open: 'Turn on', close: 'Turn off' },
  switch: { open: 'Turn on', close: 'Turn off' },
  window: { open: 'Open window', close: 'Close window' },
  elevator: { open: 'Use elevator' },
  stairs: { open: 'Stairs' },
  view: { open: 'Look at' },
  inspect: { open: 'Inspect' },
  object: { open: 'Inspect' },
  none: { open: '' },
};
