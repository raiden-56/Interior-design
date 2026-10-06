/**
 * A small PDF writer and a floor-plan renderer on top of it.
 *
 * Vector, not a screenshot: walls, openings, rooms and furniture are drawn as
 * paths at a true scale, with a title block, an area schedule and an optional
 * watermark on every page. Only the standard Helvetica font is used, so no
 * font data is embedded and the file stays small; a JPEG snapshot of the 3D
 * view can be added as a page when one is available. No dependencies.
 */

import type { Floor, Project, Wall } from '@interior/core';
import { pointOnWall, wallDir, wallLength, polygonArea, objectCorners } from '@interior/core';

export type PaperSize = 'A4' | 'A3' | 'Letter';

export interface PdfExportOptions {
  /** Floors to print, in order. */
  floors: Floor[];
  paper: PaperSize;
  watermark: string | null;
  /** Furniture outlines and names. */
  furniture: boolean;
  /** Base64 JPEG (no data: prefix) with its pixel size, added as a page. */
  snapshot?: { jpegBase64: string; width: number; height: number } | null;
  /** Shown in the title block. */
  author?: string;
  date?: Date;
}

const PAPER: Record<PaperSize, [number, number]> = { A4: [841.89, 595.28], A3: [1190.55, 841.89], Letter: [792, 612] };
const MARGIN = 28;
const TITLE_H = 70;

// --- minimal PDF object model --------------------------------------------------------

class Page {
  ops: string[] = [];
  images: { name: string; data: Uint8Array; w: number; h: number }[] = [];
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  private g(v: number): string {
    return Math.min(1, Math.max(0, v)).toFixed(3);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.6, gray = 0): void {
    this.ops.push(`q ${width.toFixed(2)} w ${this.g(gray)} G ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S Q`);
  }

  poly(points: [number, number][], opts: { fill?: number | null; stroke?: number | null; width?: number; alpha?: number; dash?: boolean } = {}): void {
    if (points.length < 2) return;
    const parts = [`q`];
    if (opts.alpha !== undefined && opts.alpha < 1) parts.push(`/GSa gs`);
    if (opts.dash) parts.push(`[3 2] 0 d`);
    parts.push(`${(opts.width ?? 0.6).toFixed(2)} w`);
    if (opts.fill != null) parts.push(`${this.g(opts.fill)} g`);
    if (opts.stroke != null) parts.push(`${this.g(opts.stroke)} G`);
    parts.push(`${n(points[0][0])} ${n(points[0][1])} m`);
    for (const p of points.slice(1)) parts.push(`${n(p[0])} ${n(p[1])} l`);
    parts.push('h');
    parts.push(opts.fill != null && opts.stroke != null ? 'B' : opts.fill != null ? 'f' : 'S');
    parts.push('Q');
    this.ops.push(parts.join(' '));
  }

  rect(x: number, y: number, w: number, h: number, opts: { fill?: number | null; stroke?: number | null; width?: number } = {}): void {
    this.poly(
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      opts,
    );
  }

  text(x: number, y: number, size: number, value: string, opts: { gray?: number; angle?: number; align?: 'left' | 'center' | 'right'; bold?: boolean; alpha?: number } = {}): void {
    const str = pdfString(value);
    const width = textWidth(value, size);
    const dx = opts.align === 'center' ? -width / 2 : opts.align === 'right' ? -width : 0;
    const a = ((opts.angle ?? 0) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const tx = x + dx * c;
    const ty = y + dx * s;
    const font = opts.bold ? '/F2' : '/F1';
    const alpha = opts.alpha !== undefined && opts.alpha < 1 ? '/GSa gs ' : '';
    this.ops.push(`q ${alpha}BT ${font} ${size.toFixed(1)} Tf ${this.g(opts.gray ?? 0)} g ${n(c)} ${n(s)} ${n(-s)} ${n(c)} ${n(tx)} ${n(ty)} Tm (${str}) Tj ET Q`);
  }

  image(data: Uint8Array, pxW: number, pxH: number, x: number, y: number, w: number, h: number): void {
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, data, w: pxW, h: pxH });
    this.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm /${name} Do Q`);
  }
}

const n = (v: number): string => (Math.abs(v) < 1e-6 ? '0' : v.toFixed(2).replace(/\.?0+$/, ''));

function pdfString(s: string): string {
  // Standard fonts know WinAnsi; anything outside Latin-1 becomes a '?'.
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (code === 0xb2) out += '\\262'; // ²
    else if (code === 0xd7) out += '\\327'; // ×
    else if (code === 0xb7) out += '\\267'; // ·
    else if (code < 32 || code > 126) out += '?';
    else out += ch;
  }
  return out;
}

/** Rough Helvetica advance widths: enough to centre and right-align labels. */
function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    if ('ijlt.,:;\'!|'.includes(ch)) w += 0.28;
    else if ('mwMW'.includes(ch)) w += 0.85;
    else if (ch === ' ') w += 0.28;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else w += 0.55;
  }
  return w * size;
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Serialises pages into a complete PDF 1.4 file. */
export function buildPdf(pages: Page[], meta: { title: string; author?: string }): Uint8Array {
  const objects: Uint8Array[] = []; // index = object number - 1
  const add = (body: Uint8Array | string): number => {
    objects.push(typeof body === 'string' ? latin1(body) : body);
    return objects.length;
  };
  const stream = (dict: string, data: Uint8Array): Uint8Array => concat([latin1(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, latin1('\nendstream')]);

  const catalogId = add(''); // placeholder, filled last
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const boldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const gsId = add('<< /Type /ExtGState /ca 0.14 /CA 0.14 >>');
  const infoId = add(`<< /Title (${pdfString(meta.title)}) /Author (${pdfString(meta.author ?? 'Interior Studio')}) /Producer (Interior Studio) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`);

  const pageIds: number[] = [];
  for (const p of pages) {
    const content = add(stream('', latin1(p.ops.join('\n'))));
    const xobjects = p.images.map((im) => ({ name: im.name, id: add(stream(`/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, im.data)) }));
    const xo = xobjects.length ? ` /XObject << ${xobjects.map((x) => `/${x.name} ${x.id} 0 R`).join(' ')} >>` : '';
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(p.width)} ${n(p.height)}] /Contents ${content} 0 R /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> /ExtGState << /GSa ${gsId} 0 R >>${xo} >> >>`));
  }
  objects[pagesId - 1] = latin1(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  objects[catalogId - 1] = latin1(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const chunks: Uint8Array[] = [latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  const offsets: number[] = [];
  let pos = chunks[0].length;
  objects.forEach((body, i) => {
    offsets.push(pos);
    const head = latin1(`${i + 1} 0 obj\n`);
    const tail = latin1('\nendobj\n');
    chunks.push(head, body, tail);
    pos += head.length + body.length + tail.length;
  });
  const xref = [`xref`, `0 ${objects.length + 1}`, `0000000000 65535 f `, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)].join('\n');
  chunks.push(latin1(`${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return concat(chunks);
}

// --- floor plan rendering ----------------------------------------------------------------

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function floorBounds(floor: Floor): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w of floor.walls) xs.push(w.a.x, w.b.x), ys.push(w.a.y, w.b.y);
  for (const r of floor.rooms) for (const p of r.points) xs.push(p.x), ys.push(p.y);
  for (const o of floor.objects) for (const c of objectCorners(o)) xs.push(c.x), ys.push(c.y);
  if (!xs.length) return { minX: 0, minY: 0, maxX: 6, maxY: 6 };
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Draws one floor onto a page; returns the drawing scale in points per metre. */
export function drawFloorPlan(page: Page, project: Project, floor: Floor, opts: { furniture: boolean; watermark: string | null; author?: string; date?: Date; pageNo: number; pageCount: number }): number {
  const b = floorBounds(floor);
  const pad = 0.6;
  const spanX = b.maxX - b.minX + pad * 2;
  const spanY = b.maxY - b.minY + pad * 2;
  const areaW = page.width - MARGIN * 2;
  const areaH = page.height - MARGIN * 2 - TITLE_H;
  const scale = Math.min(areaW / spanX, areaH / spanY);
  const ox = MARGIN + (areaW - spanX * scale) / 2 - (b.minX - pad) * scale;
  const oy = MARGIN + TITLE_H + (areaH - spanY * scale) / 2;
  // Plan y grows south; PDF y grows up.
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + (b.maxY + pad - y) * scale;
  const P = (p: { x: number; y: number }): [number, number] => [X(p.x), Y(p.y)];

  // Frame
  page.rect(MARGIN, MARGIN, page.width - MARGIN * 2, page.height - MARGIN * 2, { stroke: 0.2, width: 1 });
  page.line(MARGIN, MARGIN + TITLE_H, page.width - MARGIN, MARGIN + TITLE_H, 1, 0.2);

  // Rooms: light fill, name and area.
  for (const r of floor.rooms) {
    if (r.points.length < 3) continue;
    page.poly(r.points.map(P), { fill: 0.94, stroke: 0.55, width: 0.4 });
    const c = centroid(r.points);
    const area = Math.abs(polygonArea(r.points));
    page.text(X(c.x), Y(c.y) + 3, Math.max(6, Math.min(9, scale * 0.28)), r.name || 'Room', { align: 'center', gray: 0.15, bold: true });
    page.text(X(c.x), Y(c.y) - 6, Math.max(5, Math.min(7.5, scale * 0.22)), `${area.toFixed(1)} m²`, { align: 'center', gray: 0.35 });
  }

  // Furniture under the walls so walls stay crisp.
  if (opts.furniture) {
    for (const o of floor.objects) {
      const corners = objectCorners(o).map(P);
      page.poly(corners, { fill: 0.86, stroke: 0.4, width: 0.4 });
      // A tick on the front edge: the side a sofa or bed faces.
      const front = frontEdge(o);
      page.line(X(front[0].x), Y(front[0].y), X(front[1].x), Y(front[1].y), 1.1, 0.35);
      const w = o.width * o.scale * scale;
      const d = o.depth * o.scale * scale;
      if (Math.max(w, d) > 34) {
        const size = Math.max(4.5, Math.min(6.5, Math.min(w, d) * 0.22));
        const deg = (-o.rotation * 180) / Math.PI;
        const tilt = Math.abs(((deg % 180) + 180) % 180) > 90 ? deg + 180 : deg;
        page.text(X(o.x), Y(o.z) - size / 2.6, size, shorten(o.name, Math.floor(Math.max(w, d) / (size * 0.5))), { align: 'center', gray: 0.3, angle: tilt });
      }
    }
  }

  // Walls: filled rectangles along each segment, doors cut out and drawn with a swing.
  for (const w of floor.walls) {
    const L = wallLength(w);
    if (L < 1e-4) continue;
    const dir = wallDir(w);
    const nrm = { x: -dir.y, y: dir.x };
    const t = w.thickness / 2;
    const doors = floor.doors.filter((d) => d.wallId === w.id).sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    const solid = (from: number, to: number) => {
      if (to - from < 1e-3) return;
      const a = pointOnWall(w, from);
      const bb = pointOnWall(w, to);
      page.poly(
        [
          P({ x: a.x + nrm.x * t, y: a.y + nrm.y * t }),
          P({ x: bb.x + nrm.x * t, y: bb.y + nrm.y * t }),
          P({ x: bb.x - nrm.x * t, y: bb.y - nrm.y * t }),
          P({ x: a.x - nrm.x * t, y: a.y - nrm.y * t }),
        ],
        { fill: 0.1, stroke: 0.1, width: 0.3 },
      );
    };
    for (const d of doors) {
      const off = Math.min(Math.max(d.offset, 0), Math.max(L - d.width, 0));
      solid(cursor, off);
      drawDoor(page, w, off, d.width, d.swing, P, scale);
      cursor = off + d.width;
    }
    solid(cursor, L);
    // Windows: the wall stays, with a glass line and two frame ticks drawn over it.
    for (const win of floor.windows.filter((x) => x.wallId === w.id)) {
      const off = Math.min(Math.max(win.offset, 0), Math.max(L - win.width, 0));
      const a = pointOnWall(w, off);
      const bb = pointOnWall(w, off + win.width);
      page.poly(
        [
          P({ x: a.x + nrm.x * t, y: a.y + nrm.y * t }),
          P({ x: bb.x + nrm.x * t, y: bb.y + nrm.y * t }),
          P({ x: bb.x - nrm.x * t, y: bb.y - nrm.y * t }),
          P({ x: a.x - nrm.x * t, y: a.y - nrm.y * t }),
        ],
        { fill: 1, stroke: 0.1, width: 0.4 },
      );
      page.line(X(a.x), Y(a.y), X(bb.x), Y(bb.y), 0.6, 0.2);
      page.line(X(a.x + nrm.x * t * 0.5), Y(a.y + nrm.y * t * 0.5), X(bb.x + nrm.x * t * 0.5), Y(bb.y + nrm.y * t * 0.5), 0.3, 0.3);
      page.line(X(a.x - nrm.x * t * 0.5), Y(a.y - nrm.y * t * 0.5), X(bb.x - nrm.x * t * 0.5), Y(bb.y - nrm.y * t * 0.5), 0.3, 0.3);
    }
  }

  // Overall dimensions.
  const width = b.maxX - b.minX;
  const depth = b.maxY - b.minY;
  if (width > 0.1 && depth > 0.1) {
    const dy = Y(b.minY) + 14;
    page.line(X(b.minX), dy, X(b.maxX), dy, 0.4, 0.3);
    page.line(X(b.minX), dy - 3, X(b.minX), dy + 3, 0.4, 0.3);
    page.line(X(b.maxX), dy - 3, X(b.maxX), dy + 3, 0.4, 0.3);
    page.text((X(b.minX) + X(b.maxX)) / 2, dy + 3, 7, `${width.toFixed(2)} m`, { align: 'center', gray: 0.3 });
    const dx = X(b.maxX) + 14;
    page.line(dx, Y(b.minY), dx, Y(b.maxY), 0.4, 0.3);
    page.line(dx - 3, Y(b.minY), dx + 3, Y(b.minY), 0.4, 0.3);
    page.line(dx - 3, Y(b.maxY), dx + 3, Y(b.maxY), 0.4, 0.3);
    page.text(dx + 4, (Y(b.minY) + Y(b.maxY)) / 2, 7, `${depth.toFixed(2)} m`, { gray: 0.3, angle: -90, align: 'center' });
  }

  // North arrow.
  const nx = page.width - MARGIN - 22;
  const ny = page.height - MARGIN - 30;
  page.poly(
    [
      [nx, ny + 16],
      [nx - 6, ny - 4],
      [nx, ny],
      [nx + 6, ny - 4],
    ],
    { fill: 0.1 },
  );
  page.text(nx, ny + 20, 7, 'N', { align: 'center', bold: true });

  // Title block.
  const date = opts.date ?? new Date();
  const metresPerPoint = 1 / scale;
  const ratio = Math.round(metresPerPoint / 0.000352778); // 1 pt = 0.352778 mm
  const left = MARGIN + 10;
  const base = MARGIN + TITLE_H - 16;
  page.text(left, base, 13, project.name, { bold: true });
  page.text(left, base - 15, 8, `${floor.name} · elevation ${floor.elevation.toFixed(2)} m · floor height ${floor.height.toFixed(2)} m`, { gray: 0.3 });
  page.text(left, base - 27, 8, `Scale 1:${ratio} on ${paperName(page)} · ${opts.pageNo} / ${opts.pageCount}`, { gray: 0.3 });
  page.text(left, base - 39, 7, `${opts.author ? opts.author + ' · ' : ''}${date.toLocaleDateString(undefined, { dateStyle: 'medium' })} · Interior Studio${opts.watermark ? ' · PREVIEW — NOT FOR CONSTRUCTION' : ''}`, { gray: 0.45 });
  // Area schedule on the right of the title block.
  const totals = floor.rooms.map((r) => ({ name: r.name, area: Math.abs(polygonArea(r.points)) })).sort((a, b) => b.area - a.area);
  const total = totals.reduce((s, r) => s + r.area, 0);
  const colX = page.width - MARGIN - 10;
  page.text(colX, base, 8, `Carpet area ${total.toFixed(1)} m² · ${floor.rooms.length} rooms · ${floor.doors.length} doors · ${floor.windows.length} windows · ${floor.objects.length} items`, { align: 'right', gray: 0.2, bold: true });
  totals.slice(0, 4).forEach((r, i) => page.text(colX, base - 12 - i * 9, 6.5, `${r.name}  ${r.area.toFixed(1)} m²`, { align: 'right', gray: 0.4 }));

  if (opts.watermark) drawWatermark(page, opts.watermark);
  return scale;
}

function drawDoor(page: Page, w: Wall, offset: number, width: number, swing: 0 | 1 | 2, P: (p: { x: number; y: number }) => [number, number], scale: number): void {
  const dir = wallDir(w);
  const nrm = { x: -dir.y, y: dir.x };
  const side = swing === 2 ? -1 : 1;
  const hinge = pointOnWall(w, offset);
  const end = pointOnWall(w, offset + width);
  // Opening: a white gap across the wall, framed by two jambs.
  const t = w.thickness / 2 + 0.01;
  page.poly(
    [P({ x: hinge.x + nrm.x * t, y: hinge.y + nrm.y * t }), P({ x: end.x + nrm.x * t, y: end.y + nrm.y * t }), P({ x: end.x - nrm.x * t, y: end.y - nrm.y * t }), P({ x: hinge.x - nrm.x * t, y: hinge.y - nrm.y * t })],
    { fill: 1 },
  );
  page.line(...P({ x: hinge.x + nrm.x * t, y: hinge.y + nrm.y * t }), ...P({ x: hinge.x - nrm.x * t, y: hinge.y - nrm.y * t }), 0.5, 0.1);
  page.line(...P({ x: end.x + nrm.x * t, y: end.y + nrm.y * t }), ...P({ x: end.x - nrm.x * t, y: end.y - nrm.y * t }), 0.5, 0.1);
  if (swing === 0) return;
  // Leaf at 90° and the quarter-circle swing.
  const leafEnd = { x: hinge.x + nrm.x * side * width, y: hinge.y + nrm.y * side * width };
  page.line(...P(hinge), ...P(leafEnd), 0.7, 0.1);
  const arc: [number, number][] = [];
  const steps = Math.max(8, Math.round(width * scale / 6));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    arc.push(P({ x: hinge.x + (dir.x * Math.cos(a) + nrm.x * side * Math.sin(a)) * width, y: hinge.y + (dir.y * Math.cos(a) + nrm.y * side * Math.sin(a)) * width }));
  }
  for (let i = 1; i < arc.length; i++) page.line(arc[i - 1][0], arc[i - 1][1], arc[i][0], arc[i][1], 0.35, 0.3);
}

export function drawWatermark(page: Page, text: string): void {
  const stamp = text.trim() || 'PREVIEW';
  const size = Math.max(18, Math.min(42, page.width / Math.max(stamp.length, 8) / 0.55));
  const stepY = size * 4.2;
  const stepX = textWidth(stamp, size) + size * 2.5;
  for (let y = -page.height * 0.2; y < page.height * 1.3; y += stepY) {
    for (let x = -page.width * 0.3; x < page.width * 1.3; x += stepX) {
      page.text(x, y, size, stamp, { gray: 0.5, angle: 30, alpha: 0.14, bold: true });
    }
  }
}

function paperName(page: Page): string {
  for (const [name, [w, h]] of Object.entries(PAPER)) if (Math.abs(page.width - w) < 1 && Math.abs(page.height - h) < 1) return `${name} landscape`;
  return `${Math.round(page.width)}×${Math.round(page.height)} pt`;
}

function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

function frontEdge(o: { x: number; z: number; width: number; depth: number; scale: number; rotation: number }): [{ x: number; y: number }, { x: number; y: number }] {
  const c = objectCorners(o as never);
  // Corners run (-w,-d) (w,-d) (w,d) (-w,d); the front (+depth) edge is corners 2→3.
  return [c[2], c[3]];
}

function shorten(s: string, max: number): string {
  return s.length <= Math.max(max, 3) ? s : s.slice(0, Math.max(max - 1, 2)) + '…';
}

// --- entry point --------------------------------------------------------------------------

export function exportProjectPdf(project: Project, options: PdfExportOptions): Uint8Array {
  const [pw, ph] = PAPER[options.paper];
  const pages: Page[] = [];
  const count = options.floors.length + (options.snapshot ? 1 : 0);
  options.floors.forEach((floor, i) => {
    const page = new Page(pw, ph);
    drawFloorPlan(page, project, floor, { furniture: options.furniture, watermark: options.watermark, author: options.author, date: options.date, pageNo: i + 1, pageCount: count });
    pages.push(page);
  });
  if (options.snapshot) {
    const page = new Page(pw, ph);
    const data = base64ToBytes(options.snapshot.jpegBase64);
    const areaW = pw - MARGIN * 2;
    const areaH = ph - MARGIN * 2 - TITLE_H;
    const k = Math.min(areaW / options.snapshot.width, areaH / options.snapshot.height);
    const w = options.snapshot.width * k;
    const h = options.snapshot.height * k;
    page.rect(MARGIN, MARGIN, pw - MARGIN * 2, ph - MARGIN * 2, { stroke: 0.2, width: 1 });
    page.line(MARGIN, MARGIN + TITLE_H, pw - MARGIN, MARGIN + TITLE_H, 1, 0.2);
    page.image(data, options.snapshot.width, options.snapshot.height, MARGIN + (areaW - w) / 2, MARGIN + TITLE_H + (areaH - h) / 2, w, h);
    page.text(MARGIN + 10, MARGIN + TITLE_H - 16, 13, project.name, { bold: true });
    page.text(MARGIN + 10, MARGIN + TITLE_H - 31, 8, `3D view · ${(options.date ?? new Date()).toLocaleDateString(undefined, { dateStyle: 'medium' })} · ${options.floors.length + 1} / ${count}`, { gray: 0.3 });
    if (options.watermark) drawWatermark(page, options.watermark);
    pages.push(page);
  }
  return buildPdf(pages, { title: `${project.name} — floor plans`, author: options.author });
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]*,/, '');
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

export { Page as PdfPage };
