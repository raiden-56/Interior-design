import type { Vec2 } from './types';
import { closestPointOnSegment, sub } from './geometry';

export interface SnapTarget {
  type: 'grid' | 'point' | 'segment';
  point: Vec2;
}

export const SNAP_PRIORITY: Record<SnapTarget['type'], number> = {
  point: 3,
  segment: 2,
  grid: 1,
};

/**
 * Snapping engine. Snaps a raw cursor position onto the grid, into nearby
 * anchor points (wall endpoints / corners) and onto wall centrelines
 * (perpendicular projection), returning the best candidate.
 */
export function snapPoint(
  raw: Vec2,
  opts: {
    gridSize: number;
    /** Anchors like wall endpoints, room corners, object corners. */
    points?: Vec2[];
    /** Wall centreline segments. */
    segments?: { a: Vec2; b: Vec2 }[];
    /** Snap radius in meters (screen-space converted). */
    radius: number;
    enableGrid?: boolean;
    enablePoints?: boolean;
    enableSegments?: boolean;
  },
): SnapTarget {
  const enableGrid = opts.enableGrid ?? true;
  const enablePoints = opts.enablePoints ?? true;
  const enableSegments = opts.enableSegments ?? true;

  const candidates: SnapTarget[] = [];

  if (enableGrid && opts.gridSize > 0) {
    candidates.push({
      type: 'grid',
      point: {
        x: Math.round(raw.x / opts.gridSize) * opts.gridSize,
        y: Math.round(raw.y / opts.gridSize) * opts.gridSize,
      },
    });
  }

  if (enablePoints && opts.points) {
    for (const pt of opts.points) {
      const dx = pt.x - raw.x;
      const dy = pt.y - raw.y;
      if (Math.hypot(dx, dy) <= opts.radius) {
        candidates.push({ type: 'point', point: pt });
      }
    }
  }

  if (enableSegments && opts.segments) {
    for (const seg of opts.segments) {
      const cp = closestPointOnSegment(raw, seg.a, seg.b);
      if (cp.d <= opts.radius && cp.t > 0.02 && cp.t < 0.98) {
        candidates.push({ type: 'segment', point: cp.point });
      }
    }
  }

  candidates.sort((a, b) => SNAP_PRIORITY[b.type] - SNAP_PRIORITY[a.type]);
  return candidates[0] ?? { type: 'grid', point: raw };
}

/** True when a drag delta is below the click-vs-drag threshold. */
export const isTinyMovement = (a: Vec2, b: Vec2, threshold = 1e-4): boolean => {
  const d = sub(a, b);
  return Math.hypot(d.x, d.y) < threshold;
};