/**
 * 2D CAD export: DXF R12 (AC1009), the dialect every CAD package reads —
 * AutoCAD, LibreCAD, DraftSight, QCAD, FreeCAD, SketchUp, Revit import.
 *
 * Geometry is in metres, one layer per kind of thing (WALLS, DOORS, WINDOWS,
 * ROOMS, FURNITURE, TEXT, DIMENSIONS, WATERMARK), so the receiving side can
 * switch the furniture or the watermark off with one click. R12 was chosen
 * deliberately: it needs no handles or object dictionaries, so the file is
 * small and nothing about it is reader-specific.
 */

import type { Floor, Project } from '@interior/core';
import { pointOnWall, wallDir, wallLength, polygonArea, objectCorners } from '@interior/core';
import { floorBounds } from './pdf';

export interface DxfExportOptions {
  floors: Floor[];
  watermark: string | null;
  furniture: boolean;
  roomLabels: boolean;
  /** Metres between floors when several are laid side by side. */
  gap?: number;
}

const LAYERS: { name: string; color: number }[] = [
  { name: 'WALLS', color: 7 },
  { name: 'DOORS', color: 30 },
  { name: 'WINDOWS', color: 4 },
  { name: 'ROOMS', color: 8 },
  { name: 'FURNITURE', color: 3 },
  { name: 'TEXT', color: 7 },
  { name: 'DIMENSIONS', color: 1 },
  { name: 'TITLE', color: 7 },
  { name: 'WATERMARK', color: 9 },
];

class Dxf {
  private ent: string[] = [];
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  private track(x: number, y: number): void {
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
  }

  line(layer: string, x1: number, y1: number, x2: number, y2: number): void {
    this.track(x1, y1);
    this.track(x2, y2);
    this.ent.push('0', 'LINE', '8', layer, '10', f(x1), '20', f(y1), '30', '0', '11', f(x2), '21', f(y2), '31', '0');
  }

  polyline(layer: string, pts: [number, number][], closed = true): void {
    if (pts.length < 2) return;
    this.ent.push('0', 'POLYLINE', '8', layer, '66', '1', '70', closed ? '1' : '0');
    for (const [x, y] of pts) {
      this.track(x, y);
      this.ent.push('0', 'VERTEX', '8', layer, '10', f(x), '20', f(y), '30', '0');
    }
    this.ent.push('0', 'SEQEND', '8', layer);
  }

  arc(layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number): void {
    this.track(cx - r, cy - r);
    this.track(cx + r, cy + r);
    this.ent.push('0', 'ARC', '8', layer, '10', f(cx), '20', f(cy), '30', '0', '40', f(r), '50', f(startDeg), '51', f(endDeg));
  }

  text(layer: string, x: number, y: number, height: number, value: string, opts: { angle?: number; center?: boolean } = {}): void {
    this.track(x, y);
    const v = value.replace(/[^\x20-\x7e]/g, (ch) => (ch === '²' ? '^2' : ch === '×' ? 'x' : ch === '·' ? '-' : '?'));
    const base = ['0', 'TEXT', '8', layer, '10', f(x), '20', f(y), '30', '0', '40', f(height), '1', v, '50', f(opts.angle ?? 0)];
    if (opts.center) base.push('72', '1', '11', f(x), '21', f(y), '31', '0');
    this.ent.push(...base);
  }

  build(): string {
    const ext = Number.isFinite(this.minX) ? this : { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const header = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$EXTMIN', '10', f(ext.minX), '20', f(ext.minY), '30', '0', '9', '$EXTMAX', '10', f(ext.maxX), '20', f(ext.maxY), '30', '0', '0', 'ENDSEC'];
    const tables = [
      '0', 'SECTION', '2', 'TABLES',
      '0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0', '0', 'ENDTAB',
      '0', 'TABLE', '2', 'LAYER', '70', String(LAYERS.length),
      ...LAYERS.flatMap((l) => ['0', 'LAYER', '2', l.name, '70', '0', '62', String(l.color), '6', 'CONTINUOUS']),
      '0', 'ENDTAB',
      '0', 'TABLE', '2', 'STYLE', '70', '1', '0', 'STYLE', '2', 'STANDARD', '70', '0', '40', '0', '41', '1', '50', '0', '71', '0', '42', '0.2', '3', 'txt', '4', '', '0', 'ENDTAB',
      '0', 'ENDSEC',
    ];
    const blocks = ['0', 'SECTION', '2', 'BLOCKS', '0', 'ENDSEC'];
    const entities = ['0', 'SECTION', '2', 'ENTITIES', ...this.ent, '0', 'ENDSEC'];
    return [...header, ...tables, ...blocks, ...entities, '0', 'EOF'].join('\r\n') + '\r\n';
  }
}

const f = (v: number): string => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 10000) / 10000));

/** Writes one floor at an x offset; plan y (south) becomes -y so the drawing is the right way up. */
function drawFloor(d: Dxf, project: Project, floor: Floor, dx: number, opts: DxfExportOptions): void {
  const X = (x: number) => x + dx;
  const Y = (y: number) => -y;
  const b = floorBounds(floor);

  for (const r of floor.rooms) {
    if (r.points.length < 3) continue;
    d.polyline('ROOMS', r.points.map((p) => [X(p.x), Y(p.y)] as [number, number]));
    if (opts.roomLabels) {
      const c = r.points.reduce((a, p) => ({ x: a.x + p.x / r.points.length, y: a.y + p.y / r.points.length }), { x: 0, y: 0 });
      d.text('TEXT', X(c.x), Y(c.y) + 0.12, 0.22, r.name || 'Room', { center: true });
      d.text('TEXT', X(c.x), Y(c.y) - 0.18, 0.16, `${Math.abs(polygonArea(r.points)).toFixed(1)} m²`, { center: true });
    }
  }

  for (const w of floor.walls) {
    const L = wallLength(w);
    if (L < 1e-4) continue;
    const dir = wallDir(w);
    const nrm = { x: -dir.y, y: dir.x };
    const t = w.thickness / 2;
    const doors = floor.doors.filter((x) => x.wallId === w.id).sort((a, b2) => a.offset - b2.offset);
    const solid = (from: number, to: number) => {
      if (to - from < 1e-3) return;
      const a = pointOnWall(w, from);
      const bb = pointOnWall(w, to);
      d.polyline('WALLS', [
        [X(a.x + nrm.x * t), Y(a.y + nrm.y * t)],
        [X(bb.x + nrm.x * t), Y(bb.y + nrm.y * t)],
        [X(bb.x - nrm.x * t), Y(bb.y - nrm.y * t)],
        [X(a.x - nrm.x * t), Y(a.y - nrm.y * t)],
      ]);
    };
    let cursor = 0;
    for (const door of doors) {
      const off = Math.min(Math.max(door.offset, 0), Math.max(L - door.width, 0));
      solid(cursor, off);
      const hinge = pointOnWall(w, off);
      const end = pointOnWall(w, off + door.width);
      // Jambs
      d.line('DOORS', X(hinge.x + nrm.x * t), Y(hinge.y + nrm.y * t), X(hinge.x - nrm.x * t), Y(hinge.y - nrm.y * t));
      d.line('DOORS', X(end.x + nrm.x * t), Y(end.y + nrm.y * t), X(end.x - nrm.x * t), Y(end.y - nrm.y * t));
      if (door.swing !== 0) {
        const side = door.swing === 2 ? -1 : 1;
        const leaf = { x: hinge.x + nrm.x * side * door.width, y: hinge.y + nrm.y * side * door.width };
        d.line('DOORS', X(hinge.x), Y(hinge.y), X(leaf.x), Y(leaf.y));
        // DXF angles are counter-clockwise from +x in the flipped (y-up) frame.
        const a0 = (Math.atan2(-dir.y, dir.x) * 180) / Math.PI;
        const a1 = (Math.atan2(-(leaf.y - hinge.y), leaf.x - hinge.x) * 180) / Math.PI;
        const ccw = ((a1 - a0) % 360 + 360) % 360;
        if (ccw <= 180) d.arc('DOORS', X(hinge.x), Y(hinge.y), door.width, a0, a1);
        else d.arc('DOORS', X(hinge.x), Y(hinge.y), door.width, a1, a0);
      }
      cursor = off + door.width;
    }
    solid(cursor, L);
    for (const win of floor.windows.filter((x) => x.wallId === w.id)) {
      const off = Math.min(Math.max(win.offset, 0), Math.max(L - win.width, 0));
      const a = pointOnWall(w, off);
      const bb = pointOnWall(w, off + win.width);
      d.polyline('WINDOWS', [
        [X(a.x + nrm.x * t), Y(a.y + nrm.y * t)],
        [X(bb.x + nrm.x * t), Y(bb.y + nrm.y * t)],
        [X(bb.x - nrm.x * t), Y(bb.y - nrm.y * t)],
        [X(a.x - nrm.x * t), Y(a.y - nrm.y * t)],
      ]);
      d.line('WINDOWS', X(a.x), Y(a.y), X(bb.x), Y(bb.y));
    }
  }

  if (opts.furniture) {
    for (const o of floor.objects) {
      const c = objectCorners(o);
      d.polyline('FURNITURE', c.map((p) => [X(p.x), Y(p.y)] as [number, number]));
      // Front-edge tick so orientation survives the export.
      d.line('FURNITURE', X(c[2].x), Y(c[2].y), X(c[3].x), Y(c[3].y));
      const size = Math.min(0.18, Math.max(0.09, Math.min(o.width, o.depth) * o.scale * 0.2));
      d.text('TEXT', X(o.x), Y(o.z) - size / 2, size, o.name, { center: true, angle: ((-o.rotation * 180) / Math.PI + 360) % 360 });
    }
  }

  // Overall dimensions.
  const width = b.maxX - b.minX;
  const depth = b.maxY - b.minY;
  if (width > 0.1) {
    const y = Y(b.maxY) - 0.6;
    d.line('DIMENSIONS', X(b.minX), y, X(b.maxX), y);
    d.line('DIMENSIONS', X(b.minX), y - 0.1, X(b.minX), y + 0.1);
    d.line('DIMENSIONS', X(b.maxX), y - 0.1, X(b.maxX), y + 0.1);
    d.text('DIMENSIONS', X((b.minX + b.maxX) / 2), y - 0.35, 0.2, `${width.toFixed(2)} m`, { center: true });
  }
  if (depth > 0.1) {
    const x = X(b.maxX) + 0.6;
    d.line('DIMENSIONS', x, Y(b.minY), x, Y(b.maxY));
    d.line('DIMENSIONS', x - 0.1, Y(b.minY), x + 0.1, Y(b.minY));
    d.line('DIMENSIONS', x - 0.1, Y(b.maxY), x + 0.1, Y(b.maxY));
    d.text('DIMENSIONS', x + 0.25, Y((b.minY + b.maxY) / 2), 0.2, `${depth.toFixed(2)} m`, { center: true, angle: 90 });
  }

  // Title under the drawing.
  d.text('TITLE', X(b.minX), Y(b.maxY) - 1.3, 0.35, `${project.name} - ${floor.name}`);
  d.text('TITLE', X(b.minX), Y(b.maxY) - 1.75, 0.2, `Units: metres - ${floor.rooms.length} rooms - carpet area ${floor.rooms.reduce((s, r) => s + Math.abs(polygonArea(r.points)), 0).toFixed(1)} m²${opts.watermark ? ' - PREVIEW, NOT FOR CONSTRUCTION' : ''}`);

  if (opts.watermark) {
    const stamp = opts.watermark.trim() || 'PREVIEW';
    const h = Math.max(0.35, Math.min(width, depth) / 12);
    const stepX = stamp.length * h * 0.8 + h * 3;
    const stepY = h * 5;
    for (let y = b.minY; y <= b.maxY; y += stepY) {
      for (let x = b.minX - 1; x <= b.maxX; x += stepX) d.text('WATERMARK', X(x), Y(y), h, stamp, { angle: 30 });
    }
  }
}

export function exportProjectDxf(project: Project, options: DxfExportOptions): string {
  const d = new Dxf();
  let dx = 0;
  const gap = options.gap ?? 3;
  for (const floor of options.floors) {
    const b = floorBounds(floor);
    drawFloor(d, project, floor, dx - b.minX, options);
    dx += b.maxX - b.minX + gap + 2;
  }
  return d.build();
}
