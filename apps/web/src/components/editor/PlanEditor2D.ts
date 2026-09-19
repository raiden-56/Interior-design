'use client';

/**
 * 2D floor-plan editor controller (PixiJS).
 *
 * Responsibilities:
 * - owns the Pixi app, camera, snap preview and input handling
 * - drawing is delegated to `pixi-draw.ts` operating only on serializable state
 * - commits mutate the canonical project model through the command engine
 *
 * Drag gestures (furniture, wall endpoints) are kept as *ghost overrides* in
 * plan state so the store is never mutated during dragging — the final value is
 * committed as a command on pointer-up.
 */

import { Application, Container } from 'pixi.js';
import type { Door, Floor, Project, Vec2, Wall, Command, UnitSystem } from '@interior/core';
import {
  closestPointOnSegment,
  pointInPolygon,
  pointOnWall,
  snapPoint,
  wallLength,
} from '@interior/core';
import { drawPlan } from '../../lib/pixi/pixi-draw';
import type { PlanState } from '../../lib/pixi/pixi-draw';
import type { Camera, PlanTool, MeasureState } from '../../lib/plan-types';

export type { Camera, PlanTool, MeasureState };

export interface PlanStoreReader {
  project: Project;
  activeFloorId: string;
  tool: PlanTool;
  selection: string[];
  measure: MeasureState;
  units: UnitSystem;
  warnings: import('@interior/core').CollisionWarning[];
  /** Space is held: any left-drag pans, whatever the active tool is. */
  spacePan: boolean;
  pendingAsset: { assetId: string; name: string; shape: string; width: number; depth: number; height: number; color: string | null; mounted?: boolean } | null;
}

type DragState =
  | { mode: 'pan' }
  | { mode: 'object'; id: string }
  | { mode: 'wall-end'; id: string; which: 'a' | 'b'; ghost: { a: Vec2; b: Vec2 } }
  | { mode: 'marquee'; start: Vec2; current: Vec2 };

interface Draft {
  kind: 'wall' | 'room';
  points: Vec2[];
}

const SNAP_PX = 10;
const HIT_PX = 9;
const MAX_ZOOM = 500;
const MIN_ZOOM = 0.02;

export class PlanEditor2D {
  app!: Application;
  camera: Camera = { x: -1, y: -1, scale: 80 };

  private host: HTMLElement;
  private root = new Container();
  private dirty = false;
  private destroyed = false;
  private pointer: Vec2 | null = null;
  private drafted: Draft | null = null;
  private dragging: DragState | null = null;
  private hoveredId: string[] = [];
  private activeWall: Wall | null = null;
  private activeOffset = 0;

  private onCommand: (cmd: Command) => void;
  private onSelect: (ids: string[]) => void;
  private onMeasurePoint: (world: Vec2) => void;
  private onClearPending: () => void;
  private reader: () => PlanStoreReader;

  constructor(
    host: HTMLElement,
    opts: {
      onCommand: (cmd: Command) => void;
      onSelect: (ids: string[]) => void;
      onMeasurePoint: (world: Vec2) => void;
      onClearPending: () => void;
      reader: () => PlanStoreReader;
    },
  ) {
    this.host = host;
    this.onCommand = opts.onCommand;
    this.onSelect = opts.onSelect;
    this.onMeasurePoint = opts.onMeasurePoint;
    this.onClearPending = opts.onClearPending;
    this.reader = opts.reader;
  }

  async init(): Promise<void> {
    this.app = new Application();
    try {
      await this.app.init({
        backgroundColor: 0x0c0f14,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        resizeTo: this.host,
        preference: 'webgl',
      });
    } catch (err) {
      console.error('[PlanEditor2D] Pixi Application.init() failed:', err);
      throw err;
    }
    if (!this.app.renderer) {
      throw new Error(
        '2D engine could not start (WebGL renderer unavailable). Try a different browser or enable hardware acceleration.',
      );
    }
    if (this.destroyed) {
      this.app.destroy(true, { children: true, texture: true });
      return;
    }
    this.host.appendChild(this.app.canvas);
    this.root = new Container();
    this.app.stage.addChild(this.root);
    this.bindInput();
    this.fitView();
  }

  async snapshot(): Promise<Blob | null> {
    if (!this.app?.renderer) return null;
    const result = this.app.renderer.extract.canvas(this.root);
    if (!result) return null;
    const canvas = result as HTMLCanvasElement;
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  private bindInput(): void {
    const canvas = this.app.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel);
    canvas.addEventListener('contextmenu', this.onContext);
    canvas.addEventListener('dblclick', this.onDoubleClick);
  }

  destroy(): void {
    this.destroyed = true;
    const app = this.app;
    if (app && app.renderer) {
      const canvas = app.canvas;
      if (canvas) {
        canvas.removeEventListener('pointerdown', this.onPointerDown);
        canvas.removeEventListener('pointermove', this.onPointerMove);
        canvas.removeEventListener('pointerup', this.onPointerUp);
        canvas.removeEventListener('pointerleave', this.onPointerLeave);
        canvas.removeEventListener('wheel', this.onWheel);
        canvas.removeEventListener('contextmenu', this.onContext);
        canvas.removeEventListener('dblclick', this.onDoubleClick);
      }
      app.destroy(true, { children: true, texture: true });
    }
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: this.camera.x + (sx - this.app.screen.width / 2) / this.camera.scale,
      y: this.camera.y + (sy - this.app.screen.height / 2) / this.camera.scale,
    };
  }

  zoomAt(factor: number, clientX: number, clientY: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const world = this.screenToWorld(clientX, clientY);
    this.camera.scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.camera.scale * factor));
    this.camera.x = world.x - (sx - this.app.screen.width / 2) / this.camera.scale;
    this.camera.y = world.y - (sy - this.app.screen.height / 2) / this.camera.scale;
    this.requestRedraw();
  }

  fitView(): void {
    const s = this.reader();
    const floor = s.project.floors.find((f) => f.id === s.activeFloorId) ?? s.project.floors[0];
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 6, y: 6 },
      ...floor.walls.flatMap((w) => [w.a, w.b]),
      ...floor.rooms.flatMap((r) => r.points),
      ...floor.objects.map((o) => ({ x: o.x, y: o.z })),
    ];
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs) - 1.5;
    const maxX = Math.max(...xs) + 1.5;
    const minY = Math.min(...ys) - 1.5;
    const maxY = Math.max(...ys) + 1.5;
    const scale = Math.min((this.app.screen.width - 60) / Math.max(maxX - minX, 1e-3), (this.app.screen.height - 60) / Math.max(maxY - minY, 1e-3));
    this.camera.scale = Math.max(Math.min(scale, 250), 20);
    this.camera.x = (minX + maxX) / 2;
    this.camera.y = (minY + maxY) / 2;
    this.requestRedraw();
  }

  /**
   * Refreshes the canvas cursor from the current tool + Space state.
   *
   * Pressing or releasing Space produces no pointer event, so without this the
   * hand cursor only appeared after the next mouse move — making it look like
   * hold-to-pan had not engaged.
   */
  syncCursor(): void {
    if (!this.app?.canvas || this.dragging) return;
    const s = this.reader();
    this.app.canvas.style.cursor = s.spacePan || s.tool === 'pan' ? 'grab' : '';
  }

  requestRedraw(): void {
    if (!this.dirty) {
      this.dirty = true;
      requestAnimationFrame(() => {
        this.dirty = false;
        this.redraw();
      });
    }
  }

  redraw(): void {
    const s = this.reader();
    const floor = s.project.floors.find((f) => f.id === s.activeFloorId) ?? s.project.floors[0];
    const grid = s.project.units === 'feet' ? 0.3048 / 2 : s.project.units === 'centimeters' ? 0.1 : 0.25;

    let ghost = null;
    let wallOverride = null;
    const drag = this.dragging;
    if (drag?.mode === 'object') {
      const o = floor.objects.find((x) => x.id === drag.id);
      if (o) ghost = { id: o.id, x: this.pointer?.x ?? o.x, z: this.pointer?.y ?? o.z, rotation: o.rotation };
    } else if (drag?.mode === 'wall-end') {
      wallOverride = { id: drag.id, a: drag.ghost.a, b: drag.ghost.b };
    }
    const marquee = drag?.mode === 'marquee' ? { start: drag.start, current: drag.current } : null;

    const state: PlanState = {
      project: s.project,
      floor,
      units: s.project.units,
      selection: s.selection,
      camera: this.camera,
      viewport: { width: this.app.screen.width, height: this.app.screen.height },
      pointer: this.pointer,
      gridSize: grid,
      drafted: this.drafted,
      activeWall: this.activeWall,
      activeOffset: this.activeOffset,
      snap: this.computeSnap(floor, grid),
      hoveredIds: this.hoveredId,
      ghost,
      wallOverride,
      marquee,
      measure: s.measure,
      tool: s.tool,
      warnings: s.warnings,
    };
    drawPlan(this.root, state);
  }

  private computeSnap(floor: Floor, grid: number): ReturnType<typeof snapPoint> | null {
    if (!this.pointer || !(this.drafted || this.dragging?.mode === 'wall-end')) return null;
    const points = floor.walls.flatMap((w) => [w.a, w.b]);
    const segments = [
      ...floor.walls.map((w) => ({ a: w.a, b: w.b })),
      ...floor.rooms.flatMap((r) => r.points.map((p, i) => ({ a: p, b: r.points[(i + 1) % r.points.length] }))),
    ];
    const radius = SNAP_PX / this.camera.scale;
    return snapPoint(this.pointer, { gridSize: grid, points, segments, radius });
  }

  // --- input handlers -------------------------------------------------------

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) return;
    const s = this.reader();
    const world = this.screenToWorld(e.clientX, e.clientY);

    // Middle-drag, the Hand tool, or a left-drag while Space is held. Space is
    // read per gesture rather than by swapping the active tool, so the tool the
    // user picked is still active the moment they let go.
    if (e.button === 1 || ((s.tool === 'pan' || s.spacePan) && e.button === 0)) {
      this.dragging = { mode: 'pan' };
      this.app.canvas.setPointerCapture(e.pointerId);
      this.app.canvas.style.cursor = 'grabbing';
      return;
    }

    switch (s.tool) {
      case 'select': {
        if (s.pendingAsset) {
          this.placePendingAsset(world);
          return;
        }
        const hit = this.pick(world);
        if (hit?.type === 'object') {
          this.onSelect([hit.id]);
          this.dragging = { mode: 'object', id: hit.id };
        } else if (hit?.type === 'wall' && s.selection[0] === hit.id) {
          const wall = this.floor().walls.find((w) => w.id === hit.id);
          if (wall) {
            const da = this.distPx(world, wall.a);
            const db = this.distPx(world, wall.b);
            if (Math.min(da, db) < HIT_PX + 1) {
              this.dragging = { mode: 'wall-end', id: wall.id, which: da < db ? 'a' : 'b', ghost: { a: { ...wall.a }, b: { ...wall.b } } };
              this.onSelect([wall.id]);
              return;
            }
          }
          this.onSelect([hit.id]);
        } else if (hit) {
          this.onSelect([hit.id]);
        } else if (!e.shiftKey) {
          this.onSelect([]);
          this.dragging = { mode: 'marquee', start: world, current: world };
        }
        break;
      }
      case 'wall': {
        const snapped = this.snapWallPoint(world);
        if (!this.drafted) this.drafted = { kind: 'wall', points: [snapped] };
        break;
      }
      case 'room': {
        if (!this.drafted || this.drafted.kind !== 'room') this.drafted = { kind: 'room', points: [] };
        const snapped = snapPoint(world, { gridSize: 0.25, points: [], segments: [], radius: 0 }).point;
        this.drafted.points.push({ x: snapped.x, y: snapped.y });
        break;
      }
      case 'door':
      case 'window': {
        const hit = this.pickWall(world);
        if (hit) this.commitOpening(hit.wall, hit.offset, s.tool);
        break;
      }
      case 'measure': {
        this.onMeasurePoint(world);
        break;
      }
      case 'pan':
        break;
    }
    this.requestRedraw();
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.pointer = this.screenToWorld(e.clientX, e.clientY);

    if (!this.dragging) {
      const s = this.reader();
      if (s.spacePan) {
        this.app.canvas.style.cursor = 'grab';
        this.hoveredId = [];
      } else if (s.tool === 'select') {
        const hit = this.pick(this.pointer);
        this.hoveredId = hit ? [hit.id] : [];
        this.app.canvas.style.cursor = hit ? 'pointer' : '';
      } else if (s.tool === 'door' || s.tool === 'window') {
        const hit = this.pickWall(this.pointer);
        this.activeWall = hit?.wall ?? null;
        this.activeOffset = hit?.offset ?? 0;
        this.hoveredId = hit ? [hit.wall.id] : [];
        this.app.canvas.style.cursor = hit ? 'copy' : 'no-drop';
      } else {
        this.app.canvas.style.cursor = '';
        this.hoveredId = [];
      }
    }

    const drag = this.dragging;
    if (drag) {
      if (drag.mode === 'pan') {
        this.camera.x -= e.movementX / this.camera.scale;
        this.camera.y -= e.movementY / this.camera.scale;
      } else if (drag.mode === 'wall-end') {
        // The store's wall is left untouched during the drag: mutating it in
        // place meant the UPDATE_WALL committed on release captured the
        // already-moved endpoint as its "previous" value, so undo did nothing.
        const others = this.floor().walls.filter((w) => w.id !== drag.id);
        const snapped = snapPoint(this.pointer, {
          gridSize: 0.25,
          points: others.flatMap((w) => [w.a, w.b]),
          segments: others.map((w) => ({ a: w.a, b: w.b })),
          radius: SNAP_PX / this.camera.scale,
        });
        drag.ghost = drag.which === 'a' ? { a: snapped.point, b: drag.ghost.b } : { a: drag.ghost.a, b: snapped.point };
      } else if (drag.mode === 'marquee') {
        drag.current = this.pointer;
      }
    } else if (this.drafted?.kind === 'wall' && this.drafted.points.length === 1) {
      // preview handled by redraw
    }
    this.requestRedraw();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const drag = this.dragging;
    this.dragging = null;
    this.app.canvas.style.cursor = '';

    if (drag?.mode === 'object') {
      const obj = this.floor().objects.find((o) => o.id === drag.id);
      if (obj && this.pointer) {
        this.onCommand({ type: 'UPDATE_OBJECT', id: obj.id, patch: { x: this.pointer.x, z: this.pointer.y } });
      }
      this.requestRedraw();
      return;
    }
    if (drag?.mode === 'wall-end') {
      const wall = this.floor().walls.find((w) => w.id === drag.id);
      const moved = wall && (wall.a.x !== drag.ghost.a.x || wall.a.y !== drag.ghost.a.y || wall.b.x !== drag.ghost.b.x || wall.b.y !== drag.ghost.b.y);
      if (wall && moved) {
        this.onCommand({ type: 'UPDATE_WALL', id: wall.id, patch: { a: { ...drag.ghost.a }, b: { ...drag.ghost.b } } });
      }
      this.requestRedraw();
      return;
    }
    if (drag?.mode === 'marquee') {
      const ids = this.selectInRect(drag.start, drag.current);
      if (ids.length > 0) this.onSelect(ids);
      this.requestRedraw();
      return;
    }
    if (drag?.mode === 'pan') {
      this.syncCursor();
      return;
    }

    const s = this.reader();
    if (s.tool === 'wall' && this.drafted?.kind === 'wall' && this.drafted.points.length === 1 && this.pointer) {
      const snapped = this.snapWallPoint(this.pointer);
      const wall: Wall = {
        id: 'wall-' + Math.random().toString(36).slice(2, 9),
        a: { ...this.drafted.points[0] },
        b: snapped,
        thickness: 0.15,
        height: this.floor().height,
        color: '#d8dbe1',
        materialId: null,
      };
      if (wallLength(wall) > 0.05) {
        this.onCommand({ type: 'ADD_WALL', wall });
        this.drafted = { kind: 'wall', points: [snapped] };
      } else {
        this.drafted = null;
      }
    }
    this.requestRedraw();
  };

  private onPointerLeave = (): void => {
    this.pointer = null;
    this.hoveredId = [];
    this.activeWall = null;
    this.requestRedraw();
  };

  private onContext = (e: Event): void => {
    e.preventDefault();
    if (this.drafted?.kind === 'room' && this.drafted.points.length >= 3) {
      this.commitRoom();
    } else {
      this.drafted = null;
      this.requestRedraw();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.zoomAt(factor, e.clientX, e.clientY);
  };

  private onDoubleClick = (): void => {
    if (this.drafted) this.commitDraft();
  };

  /** True while a wall chain or room polygon is being drawn. */
  hasDraft(): boolean {
    return this.drafted !== null;
  }

  cancelDraft(): void {
    this.drafted = null;
    this.dragging = null;
    this.requestRedraw();
  }

  /**
   * Box selection: objects whose centre lies inside the rectangle, plus walls
   * with both endpoints inside. Tiny rectangles are treated as a click on
   * empty space (which already cleared the selection on pointer-down).
   */
  private selectInRect(a: Vec2, b: Vec2): string[] {
    if (this.distPx(a, b) < HIT_PX) return [];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const inside = (p: Vec2) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    const floor = this.floor();
    const ids: string[] = [];
    for (const o of floor.objects) if (inside({ x: o.x, y: o.z })) ids.push(o.id);
    for (const w of floor.walls) if (inside(w.a) && inside(w.b)) ids.push(w.id);
    return ids;
  }

  commitDraft(): void {
    if (this.drafted?.kind === 'room' && this.drafted.points.length >= 3) this.commitRoom();
    this.drafted = null;
    this.requestRedraw();
  }

  // --- helpers --------------------------------------------------------------

  private floor(): Floor {
    const s = this.reader();
    return s.project.floors.find((f) => f.id === s.activeFloorId) ?? s.project.floors[0];
  }

  private placePendingAsset(world: Vec2): void {
    const s = this.reader();
    const asset = s.pendingAsset;
    if (!asset) return;
    const floor = this.floor();
    const snapped = snapPoint(world, {
      gridSize: s.units === 'feet' ? 0.3048 / 2 : s.units === 'centimeters' ? 0.1 : 0.25,
      points: floor.walls.flatMap((w) => [w.a, w.b]),
      segments: floor.walls.map((w) => ({ a: w.a, b: w.b })),
      radius: SNAP_PX / this.camera.scale,
    });
    const id = 'obj-' + Math.random().toString(36).slice(2, 9);
    this.onCommand({
      type: 'ADD_OBJECT',
      object: {
        id,
        assetId: asset.assetId,
        name: asset.name,
        shape: asset.shape,
        x: snapped.point.x,
        z: snapped.point.y,
        rotation: 0,
        scale: 1,
        width: asset.width,
        depth: asset.depth,
        height: asset.height,
        color: asset.color,
        materialId: null,
        ...(asset.mounted ? { metadata: { mounted: true } } : {}),
      },
    });
    this.onSelect([id]);
    this.onClearPending();
    this.hoveredId = [];
    this.requestRedraw();
  }

  private distPx(a: Vec2, b: Vec2): number {
    return Math.hypot((a.x - b.x) * this.camera.scale, (a.y - b.y) * this.camera.scale);
  }

  private snapWallPoint(world: Vec2): Vec2 {
    const floor = this.floor();
    const points = floor.walls.flatMap((w) => [w.a, w.b]);
    const radius = SNAP_PX / this.camera.scale;
    return snapPoint(world, { gridSize: 0.25, points, segments: floor.walls.map((w) => ({ a: w.a, b: w.b })), radius }).point;
  }

  private pick(world: Vec2): { type: 'object' | 'wall' | 'opening' | 'room'; id: string } | null {
    const floor = this.floor();
    const thresh = HIT_PX / this.camera.scale;

    for (const o of floor.objects.slice().reverse()) {
      if (pointInRotatedRect(world, o.x, o.z, o.width * o.scale, o.depth * o.scale, o.rotation)) {
        return { type: 'object', id: o.id };
      }
    }
    for (const d of floor.doors) {
      const w = floor.walls.find((ww) => ww.id === d.wallId);
      if (!w) continue;
      const c = pointOnWall(w, d.offset + d.width / 2);
      if (this.distPx(world, c) < HIT_PX + 2) return { type: 'opening', id: d.id };
    }
    for (const win of floor.windows) {
      const w = floor.walls.find((ww) => ww.id === win.wallId);
      if (!w) continue;
      const c = pointOnWall(w, win.offset + win.width / 2);
      if (this.distPx(world, c) < HIT_PX + 2) return { type: 'opening', id: win.id };
    }
    for (const w of floor.walls.slice().reverse()) {
      const cp = closestPointOnSegment(world, w.a, w.b);
      if (cp.d < thresh) return { type: 'wall', id: w.id };
    }
    for (const r of floor.rooms.slice().reverse()) {
      if (r.points.length >= 3 && pointInPolygon(world, r.points)) return { type: 'room', id: r.id };
    }
    return null;
  }

  private pickWall(world: Vec2): { wall: Wall; offset: number } | null {
    const floor = this.floor();
    const thresh = HIT_PX / this.camera.scale;
    let best: { wall: Wall; offset: number } | null = null;
    let bestD = Infinity;
    for (const w of floor.walls) {
      const cp = closestPointOnSegment(world, w.a, w.b);
      const len = wallLength(w);
      if (cp.d < thresh && cp.d < bestD) {
        bestD = cp.d;
        const width = this.reader().tool === 'door' ? 0.9 : 1.2;
        const offset = Math.max(0, Math.min(cp.t * len, len - width));
        best = { wall: w, offset };
      }
    }
    return best;
  }

  private commitOpening(wall: Wall, offset: number, tool: PlanTool): void {
    if (tool === 'door') {
      const door: Door = {
        id: 'door-' + Math.random().toString(36).slice(2, 9),
        kind: 'door',
        wallId: wall.id,
        offset,
        width: 0.9,
        height: 2.1,
        swing: 1,
      };
      this.onCommand({ type: 'ADD_DOOR', door });
    } else {
      this.onCommand({
        type: 'ADD_WINDOW',
        window: {
          id: 'win-' + Math.random().toString(36).slice(2, 9),
          kind: 'window',
          wallId: wall.id,
          offset,
          width: 1.2,
          height: 1.4,
          sill: 0.9,
        },
      });
    }
    this.onSelect([]);
    this.requestRedraw();
  }

  private commitRoom(): void {
    const draft = this.drafted;
    if (!draft || draft.points.length < 3) return;
    const floor = this.floor();
    this.onCommand({
      type: 'ADD_ROOM',
      room: {
        id: 'room-' + Math.random().toString(36).slice(2, 9),
        name: `Room ${floor.rooms.length + 1}`,
        points: draft.points.map((p) => ({ ...p })),
        color: '#4a68a6',
        materialId: null,
      },
    });
    this.drafted = null;
    this.requestRedraw();
  }
}

function pointInRotatedRect(p: Vec2, cx: number, cz: number, w: number, d: number, rotation: number): boolean {
  const dx = p.x - cx;
  const dy = p.y - cz;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= d / 2;
}