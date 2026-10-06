'use client';

import * as React from 'react';
import { Html } from '@react-three/drei';
import { useEditorStore } from '@/stores/editor-store';
import { useWalkthroughStore } from '@/stores/walkthrough-store';

/**
 * Green start markers in the 3D editor, one per saved spawn point. Purely a
 * view of `project.walkthrough`; hidden while walking so they never show up in
 * the walkthrough itself.
 */
const EMPTY_SPAWNS: never[] = [];

export function SpawnMarkers() {
  // Select the stored array itself (or undefined). A `?? []` fallback inside
  // the selector returns a new array on every call, which Zustand treats as a
  // changed value and React reports as "Maximum update depth exceeded".
  const spawns = useEditorStore((s) => s.project.walkthrough?.spawns) ?? EMPTY_SPAWNS;
  const startId = useEditorStore((s) => s.project.walkthrough?.startSpawnId ?? null);
  const floors = useEditorStore((s) => s.project.floors);
  const phase = useWalkthroughStore((s) => s.phase);
  if (phase !== 'off' || spawns.length === 0) return null;
  return (
    <group>
      {spawns.map((sp) => {
        const floor = floors.find((f) => f.id === sp.floorId);
        if (!floor || !floor.visible) return null;
        const primary = sp.id === (startId ?? spawns[0].id);
        const color = primary ? '#22c55e' : '#86efac';
        return (
          <group key={sp.id} position={[sp.x, floor.elevation, sp.z]} rotation={[0, sp.yaw, 0]}>
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.28, 0.36, 32]} />
              <meshBasicMaterial color={color} transparent opacity={0.85} />
            </mesh>
            <mesh position={[0, 0.03, -0.42]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.1, 3]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <mesh position={[0, 0.5, 0]}>
              <cylinderGeometry args={[0.02, 0.02, 1, 8]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <mesh position={[0, 1.05, 0]}>
              <sphereGeometry args={[0.07, 12, 10]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <Html position={[0, 1.3, 0]} center distanceFactor={10} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
              <div className="whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-emerald-300">
                {primary ? 'START' : sp.name.toUpperCase()}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
