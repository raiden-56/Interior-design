'use client';

import * as React from 'react';
import { Minus, Square, X } from 'lucide-react';
import { pointOnWall, wallDir } from '@interior/core';
import { useEditorStore } from '@/stores/editor-store';
import { useWalkthroughStore } from '@/stores/walkthrough-store';
import { getRuntime } from './runtime';

/**
 * Plan-view minimap of the floor the player is on. Drawn straight from the
 * project on its own animation loop (reading the runtime, not React state),
 * so it costs nothing on the React side while the player moves.
 */
export function WalkthroughMiniMap() {
  const state = useWalkthroughStore((s) => s.minimap);
  const setMinimap = useWalkthroughStore((s) => s.setMinimap);
  const cycle = useWalkthroughStore((s) => s.cycleMinimap);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const size = state === 'mini' ? 120 : 196;

  React.useEffect(() => {
    if (state === 'hidden') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return; // 20 fps is plenty for a map
      last = now;
      const rt = getRuntime();
      const project = useEditorStore.getState().project;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      if (!rt) return;
      const snap = rt.snapshot();
      const floor = project.floors.find((f) => f.id === snap.floorId) ?? project.floors[0];
      if (!floor) return;

      // Fit the floor (full) or a window around the player (mini).
      let minX: number;
      let maxX: number;
      let minZ: number;
      let maxZ: number;
      if (state === 'mini') {
        const half = 5;
        minX = snap.x - half;
        maxX = snap.x + half;
        minZ = snap.z - half;
        maxZ = snap.z + half;
      } else {
        const b = rt.world.bounds;
        minX = b.minX - 0.5;
        maxX = b.maxX + 0.5;
        minZ = b.minZ - 0.5;
        maxZ = b.maxZ + 0.5;
      }
      const span = Math.max(maxX - minX, maxZ - minZ, 1);
      const scale = (size - 12) / span;
      const ox = (size - (maxX - minX) * scale) / 2;
      const oz = (size - (maxZ - minZ) * scale) / 2;
      const px = (x: number) => ox + (x - minX) * scale;
      const pz = (z: number) => oz + (z - minZ) * scale;

      // Rooms
      for (const r of floor.rooms) {
        if (r.points.length < 3) continue;
        ctx.beginPath();
        r.points.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.y)) : ctx.moveTo(px(p.x), pz(p.y))));
        ctx.closePath();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
        ctx.fill();
      }
      // Furniture, faintly
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      for (const o of floor.objects) {
        ctx.save();
        ctx.translate(px(o.x), pz(o.z));
        ctx.rotate(o.rotation);
        ctx.fillRect((-o.width * o.scale * scale) / 2, (-o.depth * o.scale * scale) / 2, o.width * o.scale * scale, o.depth * o.scale * scale);
        ctx.restore();
      }
      // Walls with door gaps
      ctx.lineWidth = Math.max(1.5, 0.15 * scale);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(244, 244, 245, 0.9)';
      for (const w of floor.walls) {
        const doors = floor.doors.filter((d) => d.wallId === w.id).sort((a, b) => a.offset - b.offset);
        const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        let cursor = 0;
        const seg = (from: number, to: number) => {
          if (to - from < 1e-3) return;
          const a = pointOnWall(w, from);
          const b = pointOnWall(w, to);
          ctx.beginPath();
          ctx.moveTo(px(a.x), pz(a.y));
          ctx.lineTo(px(b.x), pz(b.y));
          ctx.stroke();
        };
        for (const d of doors) {
          seg(cursor, d.offset);
          cursor = d.offset + d.width;
        }
        seg(cursor, len);
        // Door marks
        for (const d of doors) {
          const c = pointOnWall(w, d.offset + d.width / 2);
          const dir = wallDir(w);
          ctx.save();
          ctx.strokeStyle = rt.doors.isOpen(d.id) ? 'rgba(74, 222, 128, 0.9)' : 'rgba(251, 191, 36, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px(c.x - (dir.x * d.width) / 2), pz(c.y - (dir.y * d.width) / 2));
          ctx.lineTo(px(c.x + (dir.x * d.width) / 2), pz(c.y + (dir.y * d.width) / 2));
          ctx.stroke();
          ctx.restore();
        }
      }
      // Route
      const route = rt.routePoints();
      if (route.length > 1) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        route.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))));
        ctx.stroke();
        ctx.setLineDash([]);
        const end = route[route.length - 1];
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(px(end.x), pz(end.z), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Spawn points
      for (const s of project.walkthrough?.spawns ?? []) {
        if (s.floorId !== floor.id) continue;
        ctx.fillStyle = 'rgba(34, 197, 94, 0.9)';
        ctx.beginPath();
        ctx.arc(px(s.x), pz(s.z), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Player: dot + view cone. Yaw 0 looks towards -z (up on the map).
      const cx = px(snap.x);
      const cz = pz(snap.z);
      const yaw = snap.yaw;
      const dirX = -Math.sin(yaw);
      const dirZ = -Math.cos(yaw);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.beginPath();
      ctx.moveTo(cx, cz);
      const fovHalf = 0.55;
      const reach = 22;
      ctx.lineTo(cx + (dirX * Math.cos(fovHalf) - dirZ * Math.sin(fovHalf)) * reach, cz + (dirX * Math.sin(fovHalf) + dirZ * Math.cos(fovHalf)) * reach);
      ctx.lineTo(cx + (dirX * Math.cos(-fovHalf) - dirZ * Math.sin(-fovHalf)) * reach, cz + (dirX * Math.sin(-fovHalf) + dirZ * Math.cos(-fovHalf)) * reach);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = snap.seated ? '#a78bfa' : '#38bdf8';
      ctx.strokeStyle = '#0b0f16';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cz, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [state, size]);

  if (state === 'hidden') return null;
  return (
    <div className="pointer-events-auto overflow-hidden rounded-lg border border-white/10 bg-black/50 backdrop-blur">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
        <span>Map</span>
        <span className="flex items-center gap-0.5">
          <button onClick={() => setMinimap(state === 'full' ? 'mini' : 'full')} title={state === 'full' ? 'Minimise (M)' : 'Expand (M)'} className="rounded p-0.5 hover:bg-white/10 hover:text-zinc-100">
            {state === 'full' ? <Minus className="h-3 w-3" /> : <Square className="h-3 w-3" />}
          </button>
          <button onClick={() => cycle()} title="Hide map (M)" className="rounded p-0.5 hover:bg-white/10 hover:text-zinc-100">
            <X className="h-3 w-3" />
          </button>
        </span>
      </div>
      <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />
    </div>
  );
}
