import * as React from 'react';
import type { Project } from '@interior/core';
import { polygonArea } from '@interior/core';

/**
 * SVG rendering of a project's first visible floor — walls, room slabs,
 * furniture footprints, doors and windows. Pure function of the model, so it
 * costs nothing to generate and needs no stored image.
 *
 * `detail` adds room names, areas and openings: the card version stays a
 * glance, the gallery version is meant to be read and compared.
 */
export function PlanThumbnail({
  project,
  className,
  detail = false,
  size = detail ? [360, 240] : [160, 90],
}: {
  project: Project;
  className?: string;
  detail?: boolean;
  size?: [number, number];
}) {
  const floor = project.floors.find((f) => f.visible) ?? project.floors[0];
  const [W, H] = size;
  if (!floor) return null;

  const pts: { x: number; y: number }[] = [];
  for (const w of floor.walls) pts.push(w.a, w.b);
  for (const r of floor.rooms) pts.push(...r.points);
  for (const o of floor.objects) pts.push({ x: o.x, y: o.z });

  if (pts.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden="true">
        <defs>
          <pattern id="empty-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="rgba(255,255,255,0.05)" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#empty-grid)" />
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="9" fill="#52525b">
          Empty floor
        </text>
      </svg>
    );
  }

  const pad = detail ? 1.0 : 0.6;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad;
  const scale = Math.min(W / Math.max(maxX - minX, 1e-3), H / Math.max(maxY - minY, 1e-3));
  const ox = (W - (maxX - minX) * scale) / 2;
  const oy = (H - (maxY - minY) * scale) / 2;
  const sx = (x: number) => ox + (x - minX) * scale;
  const sy = (y: number) => oy + (y - minY) * scale;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden="true">
      {floor.rooms.map((r) =>
        r.points.length >= 3 ? (
          <polygon
            key={r.id}
            points={r.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
            fill={r.color.startsWith('#') ? r.color : '#4a68a6'}
            fillOpacity={detail ? 0.22 : 0.28}
          />
        ) : null,
      )}
      {floor.objects.map((o) => {
        const w = o.width * o.scale * scale;
        const d = o.depth * o.scale * scale;
        return (
          <rect
            key={o.id}
            x={-w / 2}
            y={-d / 2}
            width={w}
            height={d}
            rx={1}
            fill={o.color ?? '#8f97a9'}
            fillOpacity={o.metadata?.mounted ? 0.4 : 0.85}
            transform={`translate(${sx(o.x)} ${sy(o.z)}) rotate(${(o.rotation * 180) / Math.PI})`}
          />
        );
      })}
      {floor.walls.map((w) => (
        <line
          key={w.id}
          x1={sx(w.a.x)}
          y1={sy(w.a.y)}
          x2={sx(w.b.x)}
          y2={sy(w.b.y)}
          stroke="#d8dbe1"
          strokeWidth={Math.max(1.2, w.thickness * scale)}
          strokeLinecap="square"
        />
      ))}
      {detail &&
        [...floor.doors, ...floor.windows].map((op) => {
          // Openings are drawn as gaps in the wall line so the plan reads the
          // way a floor plan is expected to: you can see where you walk in.
          const wall = floor.walls.find((w) => w.id === op.wallId);
          if (!wall) return null;
          const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) || 1;
          const dir = { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len };
          const a = { x: wall.a.x + dir.x * op.offset, y: wall.a.y + dir.y * op.offset };
          const b = { x: a.x + dir.x * op.width, y: a.y + dir.y * op.width };
          return (
            <line
              key={op.id}
              x1={sx(a.x)}
              y1={sy(a.y)}
              x2={sx(b.x)}
              y2={sy(b.y)}
              stroke={op.kind === 'door' ? '#0c0f14' : '#7dd3fc'}
              strokeWidth={Math.max(1.6, wall.thickness * scale + 1)}
              strokeLinecap="butt"
            />
          );
        })}
      {detail &&
        floor.rooms.map((r) => {
          if (r.points.length < 3) return null;
          const cx = r.points.reduce((n, p) => n + p.x, 0) / r.points.length;
          const cy = r.points.reduce((n, p) => n + p.y, 0) / r.points.length;
          const area = Math.abs(polygonArea(r.points));
          if (area < 2.5) return null;
          return (
            <g key={`label-${r.id}`}>
              <text x={sx(cx)} y={sy(cy)} textAnchor="middle" fontSize="7.5" fill="#e4e4e7" fontWeight="500">
                {r.name}
              </text>
              <text x={sx(cx)} y={sy(cy) + 8} textAnchor="middle" fontSize="6.5" fill="#a1a1aa">
                {area.toFixed(1)} m²
              </text>
            </g>
          );
        })}
    </svg>
  );
}
