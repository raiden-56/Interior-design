'use client';

/**
 * PixiJS 2D adapter — pure rendering from serializable plan state.
 * No React, no stores; just "state in → graphics out".
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { CollisionWarning, Floor, Project, SketchUnderlay, UnitSystem, Vec2, Wall } from '@interior/core';
import { formatLength, polygonArea, wallDir, wallLength, pointOnWall } from '@interior/core';
import type { Camera, PlanTool } from '../plan-types';

export interface Ghost {
  id: string;
  x: number;
  z: number;
  rotation: number;
}

export interface PlanState {
  project: Project;
  floor: Floor;
  units: UnitSystem;
  selection: string[];
  camera: Camera;
  viewport: { width: number; height: number };
  pointer: Vec2 | null;
  gridSize: number;
  drafted: { kind: 'wall' | 'room'; points: Vec2[] } | null;
  activeWall: Wall | null;
  activeOffset: number;
  snap: { point: Vec2; type: string } | null;
  hoveredIds: string[];
  ghost: Ghost | null;
  wallOverride: { id: string; a: Vec2; b: Vec2 } | null;
  /** Box-selection rectangle while the pointer is down. */
  marquee: { start: Vec2; current: Vec2 } | null;
  measure: { from: Vec2 | null; to: Vec2 | null; active: boolean };
  warnings: CollisionWarning[];
  tool: PlanTool;
  /** Paper sketch position while it is being dragged. */
  underlayOverride?: { x: number; y: number } | null;
  /** Called when an asset (the sketch image) finished loading and the plan should redraw. */
  onAssetReady?: () => void;
}

const C = {
  wall: 0xd8dbe1,
  wallDark: 0x9aa1ad,
  gridMinor: 0x141a24,
  gridMajor: 0x1e2634,
  axis: 0x2a3444,
  select: 0x38bdf8,
  hover: 0xf59e0b,
  door: 0xaeb7c4,
  window: 0x78c8e8,
  object: 0x8f97a9,
  objectBorder: 0x64748b,
  text: 0x94a3b8,
  snap: 0xff3d81,
  warn: 0xf87171,
  ghost: 0x38bdf8,
  roomLine: 0x6b7fc9,
  measure: 0xffd166,
};

interface Label {
  text: string;
  x: number;
  y: number;
  color: number;
  size: number;
  bold: boolean;
}

export function drawPlan(root: Container, state: PlanState): void {
  root.removeChildren();
  const labels: Label[] = [];

  const toScreen = (w: Vec2) => ({
    x: (w.x - state.camera.x) * state.camera.scale + state.viewport.width / 2,
    y: (w.y - state.camera.y) * state.camera.scale + state.viewport.height / 2,
  });

  const floor = state.floor;
  const override = state.wallOverride;
  const walls: Wall[] = floor.walls.map((w) => (override && override.id === w.id ? { ...w, a: override.a, b: override.b } : w));

  // Grid first, then the paper sketch over it (its own layer so the grid
  // shows through a translucent scan), then everything drawn on top.
  const gridLayer = new Graphics();
  root.addChild(gridLayer);
  drawGrid(gridLayer, state, toScreen);
  drawOriginAxes(gridLayer, toScreen);
  drawUnderlay(root, state, toScreen);

  const g = new Graphics();
  root.addChild(g);
  drawRooms(g, state, toScreen);
  drawWalls(g, walls, toScreen);
  drawOpenings(g, state, walls, toScreen);
  drawObjects(g, state, toScreen);
  drawMeasure(g, state, toScreen);
  drawDraft(g, state, toScreen, labels);
  drawActiveOpeningPreview(g, state, toScreen);
  drawGhost(g, state, toScreen);
  drawMarquee(g, state, toScreen);
  drawSnap(g, state, toScreen);
  drawWarnings(g, state, toScreen);
  collectLabels(labels, state, walls, toScreen);

  for (const t of labels) {
    const el = new Text({
      text: t.text,
      style: {
        fontSize: t.size,
        fill: t.color,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontWeight: t.bold ? '600' : '400',
      },
    });
    el.anchor.set(0.5, 0.5);
    el.position.set(t.x, t.y);
    root.addChild(el);
  }
}

// --- paper sketch underlay -----------------------------------------------------

/**
 * Textures are cached per image source. The first draw after an import kicks
 * off the decode and returns nothing; `onAssetReady` triggers a redraw once
 * the bitmap is in, so the sketch appears without anyone touching the view.
 */
const underlayTextures = new Map<string, Texture | 'loading' | 'failed'>();

function underlayTexture(src: string, onReady?: () => void): Texture | null {
  const cached = underlayTextures.get(src);
  if (cached instanceof Texture) return cached;
  if (cached === 'loading' || cached === 'failed') return null;
  if (typeof Image === 'undefined') return null;
  underlayTextures.set(src, 'loading');
  const img = new Image();
  img.onload = () => {
    underlayTextures.set(src, Texture.from(img));
    onReady?.();
  };
  img.onerror = () => underlayTextures.set(src, 'failed');
  img.src = src;
  return null;
}

/** Plan-space corners of a sketch, honouring rotation about its top-left corner. */
export function underlayCorners(u: SketchUnderlay, pos: { x: number; y: number } = u): Vec2[] {
  const w = u.width;
  const h = u.width * u.aspect;
  const r = (u.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const pt = (lx: number, ly: number): Vec2 => ({ x: pos.x + lx * c - ly * s, y: pos.y + lx * s + ly * c });
  return [pt(0, 0), pt(w, 0), pt(w, h), pt(0, h)];
}

/** True when a plan point lies on the sketch. */
export function pointOnUnderlay(u: SketchUnderlay, p: Vec2): boolean {
  const r = (-u.rotation * Math.PI) / 180;
  const dx = p.x - u.x;
  const dy = p.y - u.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return lx >= 0 && ly >= 0 && lx <= u.width && ly <= u.width * u.aspect;
}

function drawUnderlay(root: Container, state: PlanState, toScreen: (w: Vec2) => { x: number; y: number }): void {
  const u = state.floor.underlay;
  if (!u || !u.visible || !u.src || u.width <= 0) return;
  const tex = underlayTexture(u.src, state.onAssetReady);
  if (!tex) return;
  const pos = state.underlayOverride ?? { x: u.x, y: u.y };
  const sprite = new Sprite(tex);
  const origin = toScreen(pos);
  sprite.position.set(origin.x, origin.y);
  sprite.width = u.width * state.camera.scale;
  sprite.height = u.width * u.aspect * state.camera.scale;
  sprite.rotation = (u.rotation * Math.PI) / 180;
  sprite.alpha = Math.max(0, Math.min(1, u.opacity));
  sprite.eventMode = 'none';
  root.addChild(sprite);

  // A thin outline while dragging, so the edges are visible at low opacity.
  if (state.underlayOverride) {
    const g = new Graphics();
    const pts = underlayCorners(u, pos).map(toScreen);
    g.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.closePath().stroke({ width: 1, color: 0x38bdf8, alpha: 0.9 });
    root.addChild(g);
  }
}

// --- primitive drawing helpers -----------------------------------------------

function line(g: Graphics, ax: number, ay: number, bx: number, by: number, opts: { width: number; color: number; alpha?: number }) {
  g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: opts.width, color: opts.color, alpha: opts.alpha ?? 1 });
}

function dot(g: Graphics, x: number, y: number, r: number, color: number, alpha = 1) {
  g.circle(x, y, r).fill({ color, alpha });
}

function drawGrid(g: Graphics, state: PlanState, toScreen: (w: Vec2) => { x: number; y: number }): void {
  const cam = state.camera;
  const w = state.viewport.width;
  const h = state.viewport.height;
  const majorPx = state.gridSize * cam.scale;
  let step = state.gridSize;
  if (majorPx < 9) step = state.gridSize * 5;
  const px = step * cam.scale;
  if (px < 7) return;

  const left = cam.x - w / 2 / cam.scale;
  const right = cam.x + w / 2 / cam.scale;
  const top = cam.y - h / 2 / cam.scale;
  const bottom = cam.y + h / 2 / cam.scale;

  const x0 = Math.floor(left / step) * step;
  const y0 = Math.floor(top / step) * step;
  const isMajor = (v: number) => Math.abs(v / state.gridSize - Math.round(v / state.gridSize)) < 1e-6;

  for (let x = x0; x <= right + step; x += step) {
    const p = toScreen({ x, y: top });
    line(g, p.x, 0, p.x, h, { width: 1, color: isMajor(x) ? C.gridMajor : C.gridMinor });
  }
  for (let y = y0; y <= bottom + step; y += step) {
    const p = toScreen({ x: left, y });
    line(g, 0, p.y, w, p.y, { width: 1, color: isMajor(y) ? C.gridMajor : C.gridMinor });
  }
}

function drawOriginAxes(g: Graphics, toScreen: (w: Vec2) => { x: number; y: number }): void {
  const o = toScreen({ x: 0, y: 0 });
  line(g, o.x, o.y, o.x + 24, o.y, { width: 2, color: C.window });
  line(g, o.x, o.y, o.x, o.y + 24, { width: 2, color: C.door });
}

function drawRooms(g: Graphics, state: PlanState, toScreen: (w: Vec2) => { x: number; y: number }): void {
  for (const room of state.floor.rooms) {
    if (room.points.length < 3) continue;
    const pts = room.points.map(toScreen);
    const selected = state.selection.includes(room.id);
    const hovered = state.hoveredIds.includes(room.id);
    // Rooms are floor slabs under everything else; an opaque fill would hide
    // the grid, so a hex colour gets a fixed translucency here.
    const parsed = parseColorAndAlpha(room.color, 74, 104, 166);
    const color = parsed.color;
    const alpha = parsed.alpha < 1 ? parsed.alpha : selected ? 0.42 : 0.3;
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.fill({ color, alpha });
    g.stroke({ width: selected || hovered ? 2 : 1, color: selected ? C.select : C.roomLine, alpha: 0.6 });
  }
}

function wallQuad(w: Wall, toScreen: (w: Vec2) => { x: number; y: number }) {
  const len = wallLength(w);
  if (len < 1e-5) return null;
  const d = wallDir(w);
  const n = { x: -d.y, y: d.x };
  const t = w.thickness / 2;
  const corners = [
    { x: w.a.x + n.x * t, y: w.a.y + n.y * t },
    { x: w.a.x - n.x * t, y: w.a.y - n.y * t },
    { x: w.b.x - n.x * t, y: w.b.y - n.y * t },
    { x: w.b.x + n.x * t, y: w.b.y + n.y * t },
  ].map(toScreen);
  return corners;
}

function drawWalls(g: Graphics, walls: Wall[], toScreen: (w: Vec2) => { x: number; y: number }): void {
  for (const w of walls) {
    const quad = wallQuad(w, toScreen);
    if (!quad) continue;
    const { color } = parseColorAndAlpha(w.color, 216, 219, 225);
    g.moveTo(quad[0].x, quad[0].y);
    for (let i = 1; i < 4; i++) g.lineTo(quad[i].x, quad[i].y);
    g.closePath();
    g.fill({ color, alpha: 1 });
    g.stroke({ width: 1, color: C.wallDark, alpha: 0.5 });
    dot(g, quad[0].x, quad[0].y, 1.2, C.wallDark, 0.8);
    dot(g, quad[3].x, quad[3].y, 1.2, C.wallDark, 0.8);
  }
}

function drawOpenings(
  g: Graphics,
  state: PlanState,
  walls: Wall[],
  toScreen: (w: Vec2) => { x: number; y: number },
): void {
  for (const d of state.floor.doors) {
    const wall = walls.find((w) => w.id === d.wallId);
    if (!wall) continue;
    const len = wallLength(wall);
    if (len < 1e-5) continue;
    const a = toScreen(pointOnWall(wall, Math.max(d.offset, 0)));
    const b = toScreen(pointOnWall(wall, Math.min(d.offset + d.width, len)));
    const isSel = state.selection.includes(d.id);
    const col = isSel ? C.select : C.door;
    line(g, a.x, a.y, b.x, b.y, { width: 2.4, color: 0x0c0f14 });
    line(g, a.x, a.y, b.x, b.y, { width: 1, color: col });
    // swing leaf + quarter arc (pivot at opening start)
    const r = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const swingDir = ang + Math.PI / 2;
    line(g, a.x, a.y, a.x + Math.cos(swingDir) * r, a.y + Math.sin(swingDir) * r, { width: 1, color: col });
    const seg = 14;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * (Math.PI / 2);
      const px = a.x + Math.cos(ang + t) * r;
      const py = a.y + Math.sin(ang + t) * r;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke({ width: 1.4, color: col, alpha: 0.85 });
  }

  for (const wnd of state.floor.windows) {
    const wall = walls.find((w) => w.id === wnd.wallId);
    if (!wall) continue;
    const len = wallLength(wall);
    if (len < 1e-5) continue;
    const d = wallDir(wall);
    const n = { x: -d.y, y: d.x };
    const o = wall.thickness / 2 + 0.01;
    const sPos = pointOnWall(wall, Math.max(wnd.offset, 0));
    const ePos = pointOnWall(wall, Math.min(wnd.offset + wnd.width, len));
    const isSel = state.selection.includes(wnd.id);
    const col = isSel ? C.select : C.window;
    const p = (v: Vec2) => toScreen({ x: v.x + n.x * o, y: v.y + n.y * o });
    line(g, p(sPos).x, p(sPos).y, p(ePos).x, p(ePos).y, { width: 1.4, color: col });
    const q = (v: Vec2) => toScreen({ x: v.x - n.x * o, y: v.y - n.y * o });
    line(g, q(sPos).x, q(sPos).y, q(ePos).x, q(ePos).y, { width: 1.4, color: col });
    const mid = pointOnWall(wall, wnd.offset + wnd.width / 2);
    line(g, p(mid).x, p(mid).y, q(mid).x, q(mid).y, { width: 1, color: col, alpha: 0.5 });
  }
}

function drawObjects(g: Graphics, state: PlanState, toScreen: (w: Vec2) => { x: number; y: number }): void {
  for (const o of state.floor.objects) {
    const selected = state.selection.includes(o.id);
    const hovered = state.hoveredIds.includes(o.id);
    const warn = state.warnings.some((wn) => wn.objectId === o.id && wn.level === 'error');
    const { color } = parseColorAndAlpha(o.color ?? '#8f97a9', 143, 151, 169);
    const border = selected ? C.select : hovered ? C.hover : warn ? C.warn : C.objectBorder;
    const wPx = o.width * o.scale * state.camera.scale;
    const dPx = o.depth * o.scale * state.camera.scale;
    const corners = rotatedScreenCorners(o.x, o.z, wPx, dPx, o.rotation, toScreen);

    const isRug = o.shape === 'rug';
    g.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
    g.closePath();
    g.fill({ color: selected ? lighten(color, 0.18) : color, alpha: isRug ? 0.4 : 0.8 });
    g.stroke({ width: selected || hovered || warn ? 2 : 1, color: border });

    if (o.shape === 'plant') {
      const c = toScreen({ x: o.x, y: o.z });
      dot(g, c.x, c.y, Math.max(6, Math.min(wPx, dPx) / 2), 0x4d9a5e, 0.8);
    }
    if (selected) drawHandles(g, corners, o.rotation);
  }
}

function rotatedScreenCorners(
  cx: number,
  cz: number,
  wPx: number,
  dPx: number,
  rotation: number,
  toScreen: (w: Vec2) => { x: number; y: number },
): { x: number; y: number }[] {
  const { x: sx, y: sy } = toScreen({ x: cx, y: cz });
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hwx = wPx / 2;
  const hdx = dPx / 2;
  const screen = (lx: number, ly: number) => ({ x: sx + lx * cos - ly * sin, y: sy + lx * sin + ly * cos });
  return [screen(-hwx, -hdx), screen(hwx, -hdx), screen(hwx, hdx), screen(-hwx, hdx)];
}

function drawHandles(g: Graphics, corners: { x: number; y: number }[], _rotation: number): void {
  const s = 5;
  for (const c of corners) {
    g.rect(c.x - s / 2, c.y - s / 2, s, s).fill({ color: C.select });
  }
  const c0 = corners[0];
  const c1 = corners[1];
  line(g, c0.x, c0.y, c1.x, c1.y, { width: 1, color: C.select });
}

function drawDraft(
  g: Graphics,
  state: PlanState,
  toScreen: (w: Vec2) => { x: number; y: number },
  labels: Label[],
): void {
  const draft = state.drafted;
  if (!draft) return;
  if (draft.kind === 'wall') {
    if (draft.points.length === 1 && state.pointer) {
      const a = toScreen(draft.points[0]);
      const end = state.snap?.point ?? state.pointer;
      const b = toScreen(end);
      line(g, a.x, a.y, b.x, b.y, { width: 2, color: C.snap, alpha: 0.9 });
      dot(g, a.x, a.y, 3, C.snap);
      dot(g, b.x, b.y, 3, C.snap);
      labels.push({ text: formatLength(Math.hypot(end.x - draft.points[0].x, end.y - draft.points[0].y), state.units, 2), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12, color: C.snap, size: 11, bold: true });
    }
  } else {
    const pts = draft.points.map(toScreen);
    const cur = state.pointer ? toScreen(state.pointer) : null;
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    if (cur && pts.length > 0) {
      g.lineTo(cur.x, cur.y);
      line(g, pts[pts.length - 1].x, pts[pts.length - 1].y, cur.x, cur.y, { width: 1.6, color: C.select, alpha: 0.8 });
    }
    g.stroke({ width: 1.6, color: C.select, alpha: 0.8 });
    for (const p of pts) dot(g, p.x, p.y, 3, C.select);
  }
}

function drawActiveOpeningPreview(
  g: Graphics,
  state: PlanState,
  toScreen: (w: Vec2) => { x: number; y: number },
): void {
  if (!state.activeWall || (state.tool !== 'door' && state.tool !== 'window')) return;
  const wall = state.activeWall;
  const width = state.tool === 'door' ? 0.9 : 1.2;
  const len = wallLength(wall);
  const offset = Math.min(Math.max(state.activeOffset, 0), Math.max(len - width, 0));
  const a = toScreen(pointOnWall(wall, offset));
  const b = toScreen(pointOnWall(wall, offset + width));
  line(g, a.x, a.y, b.x, b.y, { width: 4, color: C.window, alpha: 0.55 });
  dot(g, a.x, a.y, 3, C.window);
  dot(g, b.x, b.y, 3, C.window);
}

function drawGhost(g: Graphics, state: PlanState, toScreen: (w: Vec2) => { x: number; y: number }): void {
  const ghost = state.ghost;
  if (!ghost) return;
  const obj = state.floor.objects.find((o) => o.id === ghost.id);
  if (!obj) return;
  const corners = rotatedScreenCorners(ghost.x, ghost.z, obj.width * obj.scale * state.camera.scale, obj.depth * obj.scale * state.camera.scale, ghost.rotation, toScreen);
  g.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
  g.closePath();
  g.fill({ color: C.ghost, alpha: 0.22 });
  g.stroke({ width: 2, color: C.ghost, alpha: 0.9 });
}

function drawMarquee(g: Graphics, state: PlanState, toScreen: (w: Vec2) => { x: number; y: number }): void {
  const m = state.marquee;
  if (!m) return;
  const a = toScreen(m.start);
  const b = toScreen(m.current);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (w < 2 && h < 2) return;
  g.rect(x, y, w, h).fill({ color: C.select, alpha: 0.08 }).stroke({ width: 1, color: C.select, alpha: 0.8 });
}

function drawSnap(g: Graphics, state: PlanState, toScreen: (w: Vec2) => { x: number; y: number }): void {
  const snap = state.snap;
  if (!snap || !state.drafted) return;
  const p = toScreen(snap.point);
  dot(g, p.x, p.y, snap.type === 'point' ? 4 : 0, C.snap, 0.9);
  g.circle(p.x, p.y, snap.type === 'point' ? 4 : 3.5).stroke({ width: 1.4, color: C.snap, alpha: 0.9 });
  if (snap.type === 'point') {
    line(g, p.x - 7, p.y, p.x + 7, p.y, { width: 1, color: C.snap, alpha: 0.7 });
    line(g, p.x, p.y - 7, p.x, p.y + 7, { width: 1, color: C.snap, alpha: 0.7 });
  }
}

function drawWarnings(g: Graphics, state: PlanState, toScreen: (w: Vec2) => { x: number; y: number }): void {
  for (const wn of state.warnings) {
    if (wn.level !== 'error' || !wn.objectId) continue;
    const obj = state.floor.objects.find((o) => o.id === wn.objectId);
    if (!obj) continue;
    const corners = rotatedScreenCorners(obj.x, obj.z, obj.width * obj.scale * state.camera.scale, obj.depth * obj.scale * state.camera.scale, obj.rotation, toScreen);
    g.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
    g.closePath();
    g.stroke({ width: 1.6, color: C.warn, alpha: 0.9 });
  }
}

function drawMeasure(g: Graphics, state: PlanState, toScreen: (w: Vec2) => { x: number; y: number }): void {
  const m = state.measure;
  if (!m?.from || !m?.to) return;
  const a = toScreen(m.from);
  const b = toScreen(m.to);
  line(g, a.x, a.y, b.x, b.y, { width: 1.4, color: C.measure, alpha: 0.9 });
  dot(g, a.x, a.y, 3, C.measure);
  dot(g, b.x, b.y, 3, C.measure);
  const len = formatLength(Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), state.units, 2);
  const el = new Text({
    text: len,
    style: { fontSize: 12, fill: C.measure, fontWeight: '600', fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
  });
  el.anchor.set(0.5, 0.5);
  el.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 - 12);
  g.addChild(el);
}

function collectLabels(
  labels: Label[],
  state: PlanState,
  walls: Wall[],
  toScreen: (w: Vec2) => { x: number; y: number },
): void {
  const pxPerMeter = state.camera.scale;
  for (const wall of walls) {
    if (pxPerMeter * wallLength(wall) > 110) {
      const dir = wallDir(wall);
      const mid = toScreen({
        x: (wall.a.x + wall.b.x) / 2 - dir.y * 0.18,
        y: (wall.a.y + wall.b.y) / 2 + dir.x * 0.18,
      });
      labels.push({
        text: formatLength(wallLength(wall), state.units, 1),
        x: mid.x,
        y: mid.y,
        color: state.selection.includes(wall.id) || state.hoveredIds.includes(wall.id) ? C.select : C.text,
        size: 11,
        bold: false,
      });
    }
  }
  for (const room of state.floor.rooms) {
    if (room.points.length < 3) continue;
    const area = Math.abs(polygonArea(room.points));
    if (pxPerMeter * pxPerMeter * area > 25000) {
      const cx = room.points.reduce((s, p) => s + p.x, 0) / room.points.length;
      const cy = room.points.reduce((s, p) => s + p.y, 0) / room.points.length;
      const c = toScreen({ x: cx, y: cy });
      labels.push({ text: room.name, x: c.x, y: c.y, color: C.roomLine, size: 12, bold: true });
    }
  }
  for (const obj of state.floor.objects) {
    if (state.selection.includes(obj.id)) {
      const c = toScreen({ x: obj.x + obj.width * obj.scale * 0.5 + 0.2, y: obj.z - obj.depth * obj.scale * 0.5 - 0.2 });
      labels.push({ text: obj.name, x: c.x, y: c.y, color: C.select, size: 12, bold: false });
    }
  }
}

// --- color parsing -----------------------------------------------------------

function parseColorAndAlpha(
  hexOrRgba: string,
  fr: number,
  fg: number,
  fb: number,
): { color: number; alpha: number } {
  const s = hexOrRgba.trim().toLowerCase();
  if (s.startsWith('#')) {
    const clean = s.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const n = parseInt(full, 16);
    if (!Number.isNaN(n)) return { color: n, alpha: 1 };
  }
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) {
    const color = (parseInt(m[1], 10) << 16) | (parseInt(m[2], 10) << 8) | parseInt(m[3], 10);
    const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
    return { color, alpha };
  }
  return { color: (fr << 16) | (fg << 8) | fb, alpha: 1 };
}

function lighten(color: number, amt: number): number {
  const r = ((color >> 16) & 255) + (255 - ((color >> 16) & 255)) * amt;
  const g = ((color >> 8) & 255) + (255 - ((color >> 8) & 255)) * amt;
  const b = (color & 255) + (255 - (color & 255)) * amt;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}