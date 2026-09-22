'use client';

import * as React from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useEditorStore } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';

/**
 * Blender's modal transform, in the 3D view.
 *
 * `G` grab, `R` rotate, `S` scale. Once a mode is running the object follows
 * the pointer, `X`/`Y` lock it to an axis, typing enters an exact value,
 * `Ctrl` snaps, and left-click or Enter commits while Esc or right-click puts
 * everything back. It is the fastest way anyone has found to move things
 * precisely with one hand on the mouse — and it beats hunting for a gizmo
 * handle the size of a few pixels.
 *
 * The live drag is applied straight to the Three.js object so it costs nothing
 * per frame; exactly one command reaches the model, on commit, so undo stays a
 * single step.
 */
export type ModalMode = 'translate' | 'rotate' | 'scale';

interface Live {
  mode: ModalMode;
  id: string;
  /** Model values when the mode started, for cancel and for deltas. */
  start: { x: number; z: number; rotation: number; scale: number };
  /** Ground-plane point under the pointer when the mode started. */
  origin: THREE.Vector3;
  axis: 'x' | 'z' | null;
  typed: string;
}

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export function ModalTransform({ object, objectId, enabled }: { object: THREE.Object3D | null; objectId: string | null; enabled: boolean }) {
  const { camera, gl, invalidate } = useThree();
  const live = React.useRef<Live | null>(null);
  const pointer = React.useRef(new THREE.Vector2());
  const raycaster = React.useRef(new THREE.Raycaster());

  const publish = React.useCallback(() => {
    const l = live.current;
    useUiStore.getState().setModalTransform(
      l
        ? {
            mode: l.mode,
            axis: l.axis,
            typed: l.typed,
            readout: readoutFor(l, object),
          }
        : null,
    );
  }, [object]);

  const groundPoint = React.useCallback(
    (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.current.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.current.setFromCamera(pointer.current, camera);
      const hit = new THREE.Vector3();
      return raycaster.current.ray.intersectPlane(GROUND, hit) ? hit : null;
    },
    [camera, gl],
  );

  const cancel = React.useCallback(() => {
    const l = live.current;
    if (!l || !object) return;
    object.position.set(l.start.x, 0, l.start.z);
    object.rotation.y = l.start.rotation;
    object.scale.setScalar(l.start.scale);
    live.current = null;
    publish();
    invalidate();
  }, [object, publish, invalidate]);

  const commit = React.useCallback(() => {
    const l = live.current;
    if (!l || !object) return;
    live.current = null;
    publish();
    const moved =
      Math.abs(object.position.x - l.start.x) > 1e-4 ||
      Math.abs(object.position.z - l.start.z) > 1e-4 ||
      Math.abs(object.rotation.y - l.start.rotation) > 1e-4 ||
      Math.abs(object.scale.x - l.start.scale) > 1e-4;
    if (!moved) return;
    useEditorStore.getState().run(
      {
        type: 'UPDATE_OBJECT',
        id: l.id,
        patch: {
          x: round(object.position.x),
          z: round(object.position.z),
          rotation: round3(object.rotation.y),
          scale: round(object.scale.x),
        },
      },
      l.mode === 'translate' ? 'Move' : l.mode === 'rotate' ? 'Rotate' : 'Scale',
    );
    invalidate();
  }, [object, publish, invalidate]);

  /** Applies the current pointer (or typed value) to the object. */
  const apply = React.useCallback(
    (current: THREE.Vector3 | null, precise: boolean) => {
      const l = live.current;
      if (!l || !object) return;
      const typedValue = l.typed ? Number(l.typed) : null;
      const valid = typedValue !== null && Number.isFinite(typedValue);

      if (l.mode === 'translate') {
        let dx = valid && l.axis === 'x' ? typedValue : current ? current.x - l.origin.x : 0;
        let dz = valid && l.axis === 'z' ? typedValue : current ? current.z - l.origin.z : 0;
        if (valid && !l.axis) {
          dx = typedValue;
          dz = 0;
        }
        if (l.axis === 'x') dz = 0;
        if (l.axis === 'z') dx = 0;
        if (precise) {
          dx = Math.round(dx * 10) / 10;
          dz = Math.round(dz * 10) / 10;
        }
        object.position.set(l.start.x + dx, 0, l.start.z + dz);
      } else if (l.mode === 'rotate') {
        let delta: number;
        if (valid) {
          delta = (typedValue * Math.PI) / 180;
        } else if (current) {
          const a0 = Math.atan2(l.origin.z - l.start.z, l.origin.x - l.start.x);
          const a1 = Math.atan2(current.z - l.start.z, current.x - l.start.x);
          delta = -(a1 - a0);
        } else {
          delta = 0;
        }
        if (precise) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
        object.rotation.y = l.start.rotation + delta;
      } else {
        let factor: number;
        if (valid) {
          factor = typedValue;
        } else if (current) {
          const from = Math.hypot(l.origin.x - l.start.x, l.origin.z - l.start.z) || 0.001;
          const to = Math.hypot(current.x - l.start.x, current.z - l.start.z);
          factor = to / from;
        } else {
          factor = 1;
        }
        if (precise) factor = Math.round(factor * 10) / 10;
        object.scale.setScalar(clamp(l.start.scale * (valid ? factor / l.start.scale : factor), 0.2, 6));
      }
      publish();
      invalidate();
    },
    [object, publish, invalidate],
  );

  React.useEffect(() => {
    if (!enabled) return;
    const canvas = gl.domElement;
    const lastPointer = { current: null as { x: number; y: number } | null };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toLowerCase();
      const l = live.current;

      if (!l) {
        if (!object || !objectId) return;
        const mode: ModalMode | null = k === 'g' ? 'translate' : k === 'r' ? 'rotate' : k === 's' ? 'scale' : null;
        if (!mode) return;
        e.preventDefault();
        const origin = lastPointer.current ? groundPoint(lastPointer.current.x, lastPointer.current.y) : null;
        live.current = {
          mode,
          id: objectId,
          start: { x: object.position.x, z: object.position.z, rotation: object.rotation.y, scale: object.scale.x },
          origin: origin ?? new THREE.Vector3(object.position.x, 0, object.position.z),
          axis: null,
          typed: '',
        };
        publish();
        return;
      }

      e.preventDefault();
      if (e.key === 'Escape') return cancel();
      if (e.key === 'Enter') return commit();
      if (k === 'x' || k === 'y') {
        // Blender labels the floor axes X and Y; in the model Y is depth (z).
        l.axis = l.axis === (k === 'x' ? 'x' : 'z') ? null : k === 'x' ? 'x' : 'z';
        apply(lastPointer.current ? groundPoint(lastPointer.current.x, lastPointer.current.y) : null, e.ctrlKey);
        return;
      }
      if (/^[0-9.]$/.test(e.key) || (e.key === '-' && l.typed === '')) {
        l.typed += e.key;
        apply(null, false);
        return;
      }
      if (e.key === 'Backspace') {
        l.typed = l.typed.slice(0, -1);
        apply(lastPointer.current ? groundPoint(lastPointer.current.x, lastPointer.current.y) : null, false);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
      if (!live.current) return;
      apply(groundPoint(e.clientX, e.clientY), e.ctrlKey);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!live.current) return;
      // Left commits, right cancels — Blender's convention.
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) cancel();
      else commit();
    };

    const onContextMenu = (e: Event) => {
      if (live.current) e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('contextmenu', onContextMenu);
      if (live.current) cancel();
    };
  }, [enabled, gl, object, objectId, apply, cancel, commit, groundPoint, publish]);

  // Leaving the mode behind when the selection changes would strand a ghost.
  React.useEffect(() => {
    if (live.current && live.current.id !== objectId) cancel();
  }, [objectId, cancel]);

  return null;
}

function readoutFor(l: Live, object: THREE.Object3D | null): string {
  if (!object) return '';
  if (l.mode === 'translate') {
    const dx = object.position.x - l.start.x;
    const dz = object.position.z - l.start.z;
    if (l.axis === 'x') return `X ${dx >= 0 ? '+' : ''}${dx.toFixed(2)} m`;
    if (l.axis === 'z') return `Y ${dz >= 0 ? '+' : ''}${dz.toFixed(2)} m`;
    return `${dx >= 0 ? '+' : ''}${dx.toFixed(2)}, ${dz >= 0 ? '+' : ''}${dz.toFixed(2)} m`;
  }
  if (l.mode === 'rotate') {
    const deg = ((object.rotation.y - l.start.rotation) * 180) / Math.PI;
    return `${deg >= 0 ? '+' : ''}${deg.toFixed(1)}°`;
  }
  return `×${(object.scale.x / (l.start.scale || 1)).toFixed(2)}`;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
