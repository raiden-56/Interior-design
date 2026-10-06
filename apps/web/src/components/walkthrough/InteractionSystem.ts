/**
 * Generic interaction: what is in front of the player, and what E would do.
 *
 * Every door and every object in the project becomes an `Interactable` with a
 * type, a name and a reach. A ray from the centre of the camera decides what
 * is being looked at, and `promptFor` turns that into the two words shown on
 * screen. New interaction types need an entry in the verbs table and a branch
 * in the runtime's `interact()` — nothing else.
 */

import * as THREE from 'three';
import type { Door, Project, ProjectObject } from '@interior/core';
import { pointOnWall } from '@interior/core';
import { interactionOf, PROMPT_VERBS, type InteractionType } from './FurnitureInteraction';

export interface Interactable {
  id: string;
  kind: 'door' | 'object';
  type: InteractionType;
  floorId: string;
  /** Absolute floor level the thing stands on. */
  elevation: number;
  /** World centre, for distance checks. */
  x: number;
  y: number;
  z: number;
  name: string;
  /** How close you must be, metres. */
  reach: number;
  object?: ProjectObject;
  door?: Door;
  customPrompt?: string;
}

export const DEFAULT_REACH = 2.4;

export function buildInteractables(project: Project): Map<string, Interactable> {
  const out = new Map<string, Interactable>();
  for (const floor of project.floors) {
    if (!floor.visible) continue;
    for (const d of floor.doors) {
      const wall = floor.walls.find((w) => w.id === d.wallId);
      if (!wall) continue;
      const c = pointOnWall(wall, d.offset + d.width / 2);
      out.set(d.id, {
        id: d.id,
        kind: 'door',
        type: 'door',
        floorId: floor.id,
        elevation: floor.elevation,
        x: c.x,
        y: floor.elevation + d.height / 2,
        z: c.y,
        name: 'Door',
        reach: DEFAULT_REACH,
        door: d,
      });
    }
    for (const o of floor.objects) {
      const spec = interactionOf(o);
      if (spec.type === 'none') continue;
      const big = Math.max(o.width, o.depth) * o.scale;
      out.set(o.id, {
        id: o.id,
        kind: 'object',
        type: spec.type,
        floorId: floor.id,
        elevation: floor.elevation,
        x: o.x,
        y: floor.elevation + Math.min(o.height * o.scale, 1.6) / 2,
        z: o.z,
        name: o.name,
        reach: DEFAULT_REACH + big / 2,
        object: o,
        customPrompt: spec.prompt,
      });
    }
  }
  return out;
}

/** Runtime facts the prompt depends on. */
export interface PromptContext {
  seatedOn: string | null;
  doorPrompt: (doorId: string) => string | null;
  lightOn: (id: string) => boolean;
  opened: (id: string) => boolean;
  elevatorBusy: boolean;
  /** Floor names, for the stairs hint. */
  floorName: (floorId: string | null) => string | null;
  stairsLeadTo: (objectId: string) => string | null;
}

export interface Prompt {
  key: string;
  text: string;
  /** Informational only — E does nothing. */
  passive?: boolean;
}

export function promptFor(i: Interactable, ctx: PromptContext): Prompt | null {
  if (i.customPrompt && i.type !== 'door') return { key: 'E', text: i.customPrompt };
  switch (i.type) {
    case 'door': {
      const text = ctx.doorPrompt(i.id);
      if (!text) return null;
      return text === 'Locked' ? { key: 'E', text: 'Locked', passive: true } : { key: 'E', text };
    }
    case 'sit':
    case 'lie': {
      const v = PROMPT_VERBS[i.type];
      return { key: 'E', text: ctx.seatedOn === i.id ? v.close! : v.open };
    }
    case 'cabinet':
    case 'drawer': {
      const v = PROMPT_VERBS[i.type];
      return { key: 'E', text: `${ctx.opened(i.id) ? v.close : v.open} ${shortName(i.name)}` };
    }
    case 'light':
    case 'switch': {
      const v = PROMPT_VERBS[i.type];
      return { key: 'E', text: `${ctx.lightOn(i.id) ? v.close : v.open} ${shortName(i.name)}` };
    }
    case 'elevator':
      return ctx.elevatorBusy ? null : { key: 'E', text: 'Use elevator' };
    case 'stairs': {
      const to = ctx.stairsLeadTo(i.id);
      return { key: '', text: to ? `Stairs to ${to} · walk up` : 'Stairs', passive: true };
    }
    case 'view':
      return { key: 'E', text: `Look at ${shortName(i.name)}` };
    case 'inspect':
    case 'object':
      return { key: 'E', text: `Inspect ${shortName(i.name)}` };
    default:
      return null;
  }
}

function shortName(name: string): string {
  return name.length > 22 ? name.slice(0, 20) + '…' : name;
}

/** Entity id behind a picked mesh (walls, doors, windows, rooms, objects, instanced plants). */
export function entityIdOf(hit: THREE.Intersection): string | null {
  const inst = hit.object as THREE.InstancedMesh;
  if (inst.isInstancedMesh && inst.userData.instanceEntities && hit.instanceId !== undefined) {
    const ent = (inst.userData.instanceEntities as { id: string }[])[hit.instanceId];
    if (ent) return ent.id;
  }
  let o: THREE.Object3D | null = hit.object;
  while (o) {
    const e = o.userData.entity as { id?: string } | undefined;
    if (e?.id) return e.id;
    o = o.parent;
  }
  return null;
}

/**
 * What the crosshair is on. The first hit along the ray decides: a sofa
 * behind a wall is not interactable through the wall. Distance is measured
 * from the eye along the ray so a large table can be used from its edge.
 */
export function findLookTarget(
  raycaster: THREE.Raycaster,
  root: THREE.Object3D,
  interactables: Map<string, Interactable>,
  maxDistance = 3.2,
): { target: Interactable; distance: number } | null {
  raycaster.far = maxDistance;
  const hits = raycaster.intersectObject(root, true);
  for (const hit of hits) {
    if (hit.object.userData.ceiling || hit.object.userData.walkthroughHelper) continue;
    const id = entityIdOf(hit);
    if (!id) return null;
    const i = interactables.get(id);
    if (!i) return null; // a wall, window or inert object in the way
    if (hit.distance > Math.max(i.reach, maxDistance)) return null;
    return { target: i, distance: hit.distance };
  }
  return null;
}
