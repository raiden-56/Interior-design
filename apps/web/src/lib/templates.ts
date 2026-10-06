import type { Door, Floor, Project, ProjectObject, Room, Vec2, Wall, Window } from '@interior/core';
import { createFloor, createProject, polygonArea } from '@interior/core';
import { assetById } from './furniture';

/**
 * Starter layouts for the "New project" gallery.
 *
 * A blank grid is the least approachable thing to hand a first-time user; a
 * finished home they can walk through in 3D, compare against the alternatives
 * and then edit is far easier to start from. Everything here is built from the
 * same data the editor produces, so templates never drift from what the tools
 * can draw.
 *
 * Plans are laid out on a plain metre grid with the origin at the top-left of
 * the footprint: x runs east, y (the plan's vertical axis, `z` in 3D) runs
 * south.
 */

export type TemplateCategory = 'blank' | 'room' | 'studio' | '1bhk' | '2bhk' | '3bhk' | 'duplex';

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Short badge for the card and the filter chips. */
  badge: string;
  bedrooms: number;
  bathrooms: number;
  /** What this layout is good at — the basis for comparing templates. */
  highlights: string[];
  /** Who it suits, in one line. */
  bestFor: string;
  build: () => Project;
}

const rnd = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

const WALL_COLOR = '#e8e6e1';
const WALL_H = 3;

// --- structure helpers -------------------------------------------------------

function wall(a: Vec2, b: Vec2, height = WALL_H, thickness = 0.15): Wall {
  return { id: rnd('wall'), a, b, height, thickness, color: WALL_COLOR, materialId: null };
}

/** Horizontal wall at `y`, always drawn west → east so offsets read left to right. */
const wallH = (y: number, x1: number, x2: number, thickness = 0.15): Wall =>
  wall({ x: x1, y }, { x: x2, y }, WALL_H, thickness);

/** Vertical wall at `x`, always drawn north → south. */
const wallV = (x: number, y1: number, y2: number, thickness = 0.15): Wall =>
  wall({ x, y: y1 }, { x, y: y2 }, WALL_H, thickness);

/** The four walls of a rectangular shell, in consistent left-to-right / top-to-bottom order. */
function shell(x: number, y: number, w: number, d: number): { top: Wall; right: Wall; bottom: Wall; left: Wall; all: Wall[] } {
  const top = wallH(y, x, x + w, 0.2);
  const right = wallV(x + w, y, y + d, 0.2);
  const bottom = wallH(y + d, x, x + w, 0.2);
  const left = wallV(x, y, y + d, 0.2);
  return { top, right, bottom, left, all: [top, right, bottom, left] };
}

/**
 * Offset of an opening centred on a world point.
 *
 * Openings are stored as a distance from `wall.a`, which is easy to get wrong
 * by hand (and silently produces doors hanging off the end of a wall). Naming
 * the point the door should sit on and deriving the offset removes that class
 * of mistake entirely.
 */
function offsetAt(w: Wall, centre: Vec2, width: number): number {
  const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
  const t = ((centre.x - w.a.x) * (w.b.x - w.a.x) + (centre.y - w.a.y) * (w.b.y - w.a.y)) / len;
  return Math.max(0, Math.min(t - width / 2, len - width));
}

/** Door centred on `centre` (a point on the wall). */
function door(w: Wall, centre: Vec2, width = 0.9, swing: 0 | 1 | 2 = 1): Door {
  return { id: rnd('door'), kind: 'door', wallId: w.id, offset: offsetAt(w, centre, width), width, height: 2.1, swing };
}

/** Door on a horizontal wall, positioned by its x. */
const doorX = (w: Wall, x: number, width = 0.9): Door => door(w, { x, y: w.a.y }, width);
/** Door on a vertical wall, positioned by its y. */
const doorY = (w: Wall, y: number, width = 0.9): Door => door(w, { x: w.a.x, y }, width);

function win(w: Wall, centre: Vec2, width = 1.4, sill = 0.9, height = 1.5): Window {
  return { id: rnd('win'), kind: 'window', wallId: w.id, offset: offsetAt(w, centre, width), width, height, sill };
}

const winX = (w: Wall, x: number, width = 1.4, sill = 0.9, height = 1.5): Window =>
  win(w, { x, y: w.a.y }, width, sill, height);
const winY = (w: Wall, y: number, width = 1.4, sill = 0.9, height = 1.5): Window =>
  win(w, { x: w.a.x, y }, width, sill, height);

const ROOM_COLORS: Record<string, string> = {
  living: '#4a68a6',
  bedroom: '#6b5b95',
  bath: '#4a8a9a',
  kitchen: '#8a7a4a',
  utility: '#5f7a63',
  hall: '#8a8a80',
  dining: '#5b7a8a',
};

function room(name: string, points: Vec2[], kind: keyof typeof ROOM_COLORS = 'living', materialId: string | null = 'wood-oak'): Room {
  return { id: rnd('room'), name, points, color: ROOM_COLORS[kind], materialId };
}

/** Rectangular room from its two opposite corners. */
const rect = (name: string, x1: number, y1: number, x2: number, y2: number, kind: keyof typeof ROOM_COLORS = 'living', materialId: string | null = 'wood-oak'): Room =>
  room(name, [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }], kind, materialId);

// --- furniture helpers -------------------------------------------------------

/**
 * Places a catalog item.
 *
 * Throws on an unknown id rather than skipping it: these ids used to be
 * silently dropped, which is how every template ended up shipping as an empty
 * shell. A typo now fails the template test instead of quietly furnishing
 * nothing.
 */
function place(assetId: string, x: number, z: number, rotation = 0, color?: string): ProjectObject {
  const a = assetById(assetId);
  if (!a) throw new Error(`templates: unknown asset "${assetId}"`);
  return {
    id: rnd('obj'),
    assetId: a.id,
    name: a.name,
    shape: a.shape,
    x,
    z,
    rotation,
    scale: 1,
    width: a.width,
    depth: a.depth,
    height: a.height,
    color: color ?? a.color,
    materialId: null,
    // Wall/ceiling pieces are excluded from floor clearance checks.
    ...(a.mounted ? { metadata: { mounted: true } } : {}),
  };
}

const GAP = 0.05;
const dims = (assetId: string) => {
  const a = assetById(assetId);
  if (!a) throw new Error(`templates: unknown asset "${assetId}"`);
  return a;
};

/**
 * Against-a-wall placements. The name is the wall the item's back is on, so
 * `north(...)` stands an item against the wall above it, facing into the room.
 * Rotation is applied so the footprint stays clear of the wall line.
 */
const north = (assetId: string, x: number, wallY: number, color?: string): ProjectObject =>
  place(assetId, x, wallY + dims(assetId).depth / 2 + GAP, 0, color);
const south = (assetId: string, x: number, wallY: number, color?: string): ProjectObject =>
  place(assetId, x, wallY - dims(assetId).depth / 2 - GAP, Math.PI, color);
const west = (assetId: string, wallX: number, z: number, color?: string): ProjectObject =>
  place(assetId, wallX + dims(assetId).depth / 2 + GAP, z, -Math.PI / 2, color);
const east = (assetId: string, wallX: number, z: number, color?: string): ProjectObject =>
  place(assetId, wallX - dims(assetId).depth / 2 - GAP, z, Math.PI / 2, color);

function withFloor(project: Project, fill: (f: Floor) => void): Project {
  fill(project.floors[0]);
  project.updatedAt = Date.now();
  return project;
}

/** Adds an upper floor at the project's floor height and fills it. */
function withUpperFloor(project: Project, name: string, fill: (f: Floor) => void): Project {
  const below = project.floors[project.floors.length - 1];
  const floor = createFloor(name);
  floor.height = project.floorHeight;
  floor.elevation = below.elevation + project.floorHeight;
  fill(floor);
  project.floors.push(floor);
  project.updatedAt = Date.now();
  return project;
}

// --- reporting ---------------------------------------------------------------

export interface TemplateStats {
  /** Footprint of the drawn walls, e.g. "10.0 × 9.0 m". */
  footprint: string;
  /** Sum of the room polygons, in m². */
  carpetArea: number;
  rooms: { id: string; name: string; area: number }[];
  objects: number;
  doors: number;
  windows: number;
}

/** Everything the gallery needs to describe a plan, derived from the plan itself (all floors). */
export function templateStats(project: Project): TemplateStats {
  const floor = project.floors[0];
  const xs = floor.walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = floor.walls.flatMap((w) => [w.a.y, w.b.y]);
  const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const depth = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const multi = project.floors.length > 1;
  const rooms = project.floors.flatMap((f) =>
    f.rooms.map((r) => ({ id: r.id, name: multi ? `${r.name} · ${f.name}` : r.name, area: Math.abs(polygonArea(r.points)) })),
  );
  return {
    footprint: width && depth ? `${width.toFixed(1)} × ${depth.toFixed(1)} m${multi ? ` · ${project.floors.length} floors` : ''}` : '—',
    carpetArea: rooms.reduce((sum, r) => sum + r.area, 0),
    rooms: rooms.sort((a, b) => b.area - a.area),
    objects: project.floors.reduce((n, f) => n + f.objects.length, 0),
    doors: project.floors.reduce((n, f) => n + f.doors.length, 0),
    windows: project.floors.reduce((n, f) => n + f.windows.length, 0),
  };
}

export const SQM_TO_SQFT = 10.7639;

// --- the templates -----------------------------------------------------------

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'blank',
    name: 'Blank canvas',
    description: 'Empty floor. Draw walls from scratch or drop in a quick room.',
    category: 'blank',
    badge: 'Empty',
    bedrooms: 0,
    bathrooms: 0,
    highlights: ['Nothing placed for you', 'Quick-room shortcuts in the Structure tab'],
    bestFor: 'Drawing your own plan, or tracing one you already have',
    build: () => createProject('Untitled Project'),
  },

  {
    id: '1bhk',
    name: '1 BHK apartment',
    description:
      'One bedroom, a combined bathroom-and-laundry, a galley kitchen and a wide living-dining room across the front.',
    category: '1bhk',
    badge: '1 BHK',
    bedrooms: 1,
    bathrooms: 1,
    highlights: [
      'Every room opens off the living room — no wasted corridor',
      'Laundry inside the bathroom keeps plumbing on one wall',
      'Living-dining runs the full 8 m width',
    ],
    bestFor: 'A couple or a single occupant, or a rental unit',
    build: () =>
      withFloor(createProject('1 BHK Apartment'), (f) => {
        const s = shell(0, 0, 8, 7);
        const mid = wallH(3.6, 0, 8);
        const bedWall = wallV(4.0, 0, 3.6);
        const kitWall = wallV(6.0, 0, 3.6);
        f.walls.push(...s.all, mid, bedWall, kitWall);

        f.doors.push(
          doorY(s.right, 6.4, 1.0), // main entrance
          doorX(mid, 2.0),
          doorX(mid, 5.0, 0.8),
          doorX(mid, 7.0),
        );
        f.windows.push(
          winX(s.top, 2.0, 1.6),
          winX(s.top, 7.0, 1.0),
          winY(s.left, 1.8, 1.4),
          winY(s.left, 5.4, 1.8),
          winX(s.bottom, 2.6, 2.4),
          winY(s.right, 2.0, 1.0, 1.5, 0.8),
        );

        f.rooms.push(
          rect('Bedroom', 0, 0, 4.0, 3.6, 'bedroom'),
          rect('Bathroom & Laundry', 4.0, 0, 6.0, 3.6, 'bath', 'stone-marble'),
          rect('Kitchen', 6.0, 0, 8.0, 3.6, 'kitchen', 'stone-marble'),
          rect('Living & Dining', 0, 3.6, 8.0, 7.0, 'living'),
        );

        f.objects.push(
          // Bedroom
          north('bedroom-queen-bed', 1.6, 0, '#d8cfc2'),
          north('bedroom-nightstand', 2.75, 0),
          east('bedroom-wardrobe', 4.0, 2.6),
          west('bedroom-study-table', 0, 2.9),
          place('office-office-chair', 1.1, 2.9, Math.PI / 2),
          north('living-split-ac', 3.5, 0),
          place('living-ceiling-fan', 2.0, 1.8),

          // Bathroom & laundry
          west('bathroom-toilet', 4.0, 0.6),
          west('bathroom-basin-sink', 4.0, 1.7),
          west('bathroom-mirror', 4.0, 1.7),
          place('bathroom-shower', 5.5, 0.5),
          east('kitchen-washing-machine', 6.0, 2.4),
          east('bathroom-water-heater', 6.0, 1.5),

          // Kitchen
          north('kitchen-kitchen-cabinet', 7.0, 0),
          east('kitchen-kitchen-sink', 8.0, 1.2),
          east('kitchen-oven-range', 8.0, 2.2),
          east('kitchen-chimney-hood', 8.0, 2.2),
          west('kitchen-refrigerator', 6.0, 1.1),
          west('kitchen-microwave', 6.0, 1.9),

          // Living & dining
          north('living-tv-unit', 3.5, 3.6),
          north('living-wall-tv-55-inch', 3.5, 3.6),
          south('living-sofa-3-seat', 3.5, 7.0, '#6f7482'),
          place('living-coffee-table', 3.5, 5.5),
          place('living-rug', 3.5, 5.6, 0, '#8f8577'),
          place('dining-dining-table-6-seat', 6.2, 5.4),
          place('dining-dining-chair', 5.4, 4.7),
          place('dining-dining-chair', 7.0, 4.7),
          place('dining-dining-chair', 5.4, 6.1, Math.PI),
          place('dining-dining-chair', 7.0, 6.1, Math.PI),
          east('living-shoe-rack', 8.0, 5.2),
          place('living-floor-plant', 0.5, 6.5),
          place('living-ceiling-fan', 3.5, 5.4),
          place('lighting-floor-lamp', 0.5, 4.2),
        );
      }),
  },

  {
    id: '2bhk',
    name: '2 BHK family apartment',
    description:
      'Two bedrooms and a study off a central passage, with the living, kitchen and utility balcony along the back.',
    category: '2bhk',
    badge: '2 BHK',
    bedrooms: 2,
    bathrooms: 1,
    highlights: [
      'Bedrooms are grouped away from the living room',
      'Study / home-office room with its own door',
      'Separate utility balcony for the washer and dishwasher',
    ],
    bestFor: 'A small family that needs a quiet room to work in',
    build: () =>
      withFloor(createProject('2 BHK Family Apartment'), (f) => {
        const s = shell(0, 0, 10, 9);
        const passN = wallH(4.2, 0, 10);
        const passS = wallH(5.4, 0, 10);
        const bedSplit = wallV(3.8, 0, 4.2);
        const bath = wallV(7.2, 0, 4.2);
        const bathS = wallH(2.4, 7.2, 10);
        const kitW = wallV(6.2, 5.4, 9);
        const kitE = wallV(8.4, 5.4, 9);
        f.walls.push(...s.all, passN, passS, bedSplit, bath, bathS, kitW, kitE);

        f.doors.push(
          doorX(s.bottom, 1.6, 1.0), // main entrance
          doorX(passN, 2.6),
          doorX(passN, 5.6),
          doorX(passN, 8.6, 0.8),
          doorY(bath, 1.4, 0.75),
          doorX(passS, 0.8, 1.0),
          doorX(passS, 6.9),
          doorY(kitE, 7.2, 0.8),
        );
        f.windows.push(
          winX(s.top, 1.8, 1.6),
          winX(s.top, 5.4, 1.6),
          winX(s.top, 8.8, 1.0, 1.5, 0.8),
          winY(s.left, 2.0, 1.4),
          winY(s.left, 7.2, 1.8),
          winX(s.bottom, 4.4, 2.0),
          winY(s.right, 3.4, 1.2),
          winY(s.right, 7.0, 1.4),
        );

        f.rooms.push(
          rect('Master Bedroom', 0, 0, 3.8, 4.2, 'bedroom'),
          rect('Bedroom 2', 3.8, 0, 7.2, 4.2, 'bedroom'),
          rect('Bathroom', 7.2, 0, 10, 2.4, 'bath', 'stone-marble'),
          rect('Study', 7.2, 2.4, 10, 4.2, 'hall'),
          rect('Passage', 0, 4.2, 10, 5.4, 'hall'),
          rect('Living & Dining', 0, 5.4, 6.2, 9, 'living'),
          rect('Kitchen', 6.2, 5.4, 8.4, 9, 'kitchen', 'stone-marble'),
          rect('Utility & Balcony', 8.4, 5.4, 10, 9, 'utility', 'stone-slate'),
        );

        f.objects.push(
          // Master bedroom
          north('bedroom-king-bed', 1.5, 0, '#cfc4b4'),
          north('bedroom-nightstand', 0.3, 0),
          north('bedroom-nightstand', 2.7, 0),
          west('bedroom-wardrobe', 0, 3.2),
          east('bedroom-dressing-table', 3.8, 1.6),
          north('living-split-ac', 3.2, 0),
          place('living-ceiling-fan', 1.9, 2.0),

          // Bedroom 2
          north('bedroom-queen-bed', 4.8, 0, '#d8cfc2'),
          north('bedroom-nightstand', 5.9, 0),
          west('bedroom-wardrobe', 3.8, 3.2),
          east('bedroom-study-table', 7.2, 3.2),
          place('office-office-chair', 6.3, 3.2, -Math.PI / 2),
          north('living-split-ac', 6.6, 0),
          place('living-ceiling-fan', 5.5, 2.1),

          // Bathroom
          north('bathroom-toilet', 9.5, 0),
          north('bathroom-basin-sink', 8.4, 0),
          north('bathroom-mirror', 8.4, 0),
          place('bathroom-shower', 9.5, 1.9),
          east('bathroom-water-heater', 10, 2.0),

          // Study
          north('office-desk', 8.4, 2.4),
          place('office-office-chair', 8.0, 3.4),
          east('living-bookshelf', 10, 3.2),

          // Living & dining
          north('living-tv-unit', 3.4, 5.4),
          north('living-wall-tv-55-inch', 3.4, 5.4),
          south('living-sofa-3-seat', 3.4, 9, '#6f7482'),
          place('living-coffee-table', 3.4, 7.3),
          place('living-rug', 3.4, 7.4, 0, '#8f8577'),
          place('dining-dining-table-rect', 1.4, 7.0),
          place('dining-dining-chair', 1.4, 6.2),
          place('dining-dining-chair', 1.4, 7.8, Math.PI),
          east('dining-crockery-unit', 6.2, 6.2),
          west('living-shoe-rack', 0, 6.6),
          place('living-floor-plant', 5.8, 8.6),
          place('living-ceiling-fan', 3.0, 7.4),

          // Kitchen
          west('kitchen-kitchen-cabinet', 6.2, 7.0),
          west('kitchen-kitchen-sink', 6.2, 8.2),
          south('kitchen-oven-range', 7.7, 9),
          south('kitchen-chimney-hood', 7.7, 9),
          east('kitchen-refrigerator', 8.4, 6.0),

          // Utility
          east('kitchen-washing-machine', 10, 6.0),
          east('kitchen-dishwasher', 10, 8.3),
        );
      }),
  },

  {
    id: '2bhk-open',
    name: '2 BHK open-plan',
    description:
      'A master suite with its own bathroom and walk-in wardrobe, a second bedroom, and one open living-dining-kitchen space.',
    category: '2bhk',
    badge: '2 BHK',
    bedrooms: 2,
    bathrooms: 2,
    highlights: [
      'Kitchen island opens straight onto the dining and lounge',
      'Master suite: attached bathroom plus a walk-in wardrobe',
      'A single 11 m wide social space — good for testing lighting',
    ],
    bestFor: 'Open-plan living, entertaining, and showing a design off in 3D',
    build: () =>
      withFloor(createProject('2 BHK Open-Plan'), (f) => {
        const s = shell(0, 0, 11, 8);
        const spine = wallH(4.6, 0, 11);
        const mBathW = wallV(4.2, 0, 4.6);
        const mBathE = wallV(6.0, 0, 4.6);
        const bed2E = wallV(8.8, 0, 4.6);
        const mBathS = wallH(2.6, 4.2, 6.0);
        f.walls.push(...s.all, spine, mBathW, mBathE, bed2E, mBathS);

        f.doors.push(
          doorY(s.left, 6.6, 1.0), // main entrance
          doorX(spine, 1.8),
          doorY(mBathW, 1.2, 0.75),
          doorY(mBathW, 3.6, 0.75),
          doorX(spine, 7.2),
          doorX(spine, 9.8, 0.8),
        );
        f.windows.push(
          winX(s.top, 2.0, 2.0),
          winX(s.top, 7.4, 1.6),
          winX(s.top, 9.8, 1.0, 1.5, 0.8),
          winY(s.left, 2.2, 1.4),
          winX(s.bottom, 2.6, 2.4),
          winX(s.bottom, 8.0, 2.0),
          winY(s.right, 6.4, 1.8),
        );

        f.rooms.push(
          rect('Master Bedroom', 0, 0, 4.2, 4.6, 'bedroom'),
          rect('Master Bathroom', 4.2, 0, 6.0, 2.6, 'bath', 'stone-marble'),
          rect('Walk-in Wardrobe', 4.2, 2.6, 6.0, 4.6, 'hall'),
          rect('Bedroom 2', 6.0, 0, 8.8, 4.6, 'bedroom'),
          rect('Bathroom & Laundry', 8.8, 0, 11, 4.6, 'bath', 'stone-marble'),
          rect('Living · Dining · Kitchen', 0, 4.6, 11, 8, 'living'),
        );

        f.objects.push(
          // Master bedroom
          north('bedroom-king-bed', 1.6, 0, '#cfc4b4'),
          north('bedroom-nightstand', 0.35, 0),
          north('bedroom-nightstand', 2.85, 0),
          west('bedroom-dressing-table', 0, 3.4),
          south('living-wall-tv-55-inch', 3.2, 4.6),
          north('living-split-ac', 3.4, 0),
          place('living-ceiling-fan', 1.6, 2.2),

          // Master bathroom
          north('bathroom-toilet', 5.7, 0),
          north('bathroom-basin-sink', 4.9, 0),
          north('bathroom-mirror', 4.9, 0),
          place('bathroom-shower', 5.5, 2.1),

          // Walk-in wardrobe
          east('bedroom-wardrobe', 6.0, 3.6),
          south('decoration-full-length-mirror', 4.6, 4.6),

          // Bedroom 2
          north('bedroom-queen-bed', 6.9, 0, '#d8cfc2'),
          north('bedroom-nightstand', 8.05, 0),
          east('bedroom-wardrobe', 8.8, 3.3),
          west('bedroom-study-table', 6.0, 3.6),
          north('living-split-ac', 8.2, 0),
          place('living-ceiling-fan', 7.2, 2.2),

          // Bathroom & laundry
          north('bathroom-toilet', 9.2, 0),
          north('bathroom-basin-sink', 10.2, 0),
          north('bathroom-mirror', 10.2, 0),
          east('bathroom-bathtub', 11, 2.2),
          west('kitchen-washing-machine', 8.8, 2.0),
          west('bathroom-water-heater', 8.8, 3.2),

          // Open living
          north('living-tv-unit', 3.3, 4.6),
          north('living-wall-tv-55-inch', 3.3, 4.6),
          south('living-sofa-3-seat', 3.5, 8, '#6f7482'),
          place('living-armchair', 1.7, 6.5, -Math.PI / 2, '#8a6f61'),
          place('living-coffee-table', 3.5, 6.2),
          place('living-rug', 3.5, 6.3, 0, '#8f8577'),
          place('living-floor-plant', 0.5, 7.6),

          // Dining
          place('dining-dining-table-6-seat', 6.4, 6.4),
          place('dining-dining-chair', 5.7, 5.7),
          place('dining-dining-chair', 7.1, 5.7),
          place('dining-dining-chair', 5.7, 7.1, Math.PI),
          place('dining-dining-chair', 7.1, 7.1, Math.PI),
          place('lighting-pendant-light', 6.0, 6.4),
          place('lighting-pendant-light', 6.8, 6.4),

          // Kitchen end
          place('kitchen-kitchen-island', 9.2, 6.1),
          place('kitchen-bar-stool', 8.7, 7.0, Math.PI),
          place('kitchen-bar-stool', 9.7, 7.0, Math.PI),
          south('kitchen-kitchen-sink', 9.0, 8),
          south('kitchen-oven-range', 10.2, 8),
          south('kitchen-chimney-hood', 10.2, 8),
          south('kitchen-dishwasher', 8.2, 8),
          east('kitchen-double-door-fridge', 11, 5.6),
          place('living-ceiling-fan', 3.5, 6.4),
        );
      }),
  },

  {
    id: '3bhk',
    name: '3 BHK apartment',
    description:
      'Three bedrooms (one with an attached bathroom), a common bathroom, a passage, and a living, kitchen and utility wing.',
    category: '3bhk',
    badge: '3 BHK',
    bedrooms: 3,
    bathrooms: 2,
    highlights: [
      'Master bedroom with an attached bathroom',
      'Kids room set up with a bunk bed and a study corner',
      'Full kitchen: hob, chimney, fridge, dishwasher and pantry',
    ],
    bestFor: 'A family of four or five, or anyone planning a full flat',
    build: () =>
      withFloor(createProject('3 BHK Apartment'), (f) => {
        const s = shell(0, 0, 12, 10);
        const passN = wallH(4.4, 0, 12);
        const passS = wallH(5.6, 0, 12);
        const mBathW = wallV(4.0, 0, 4.4);
        const mBathE = wallV(5.8, 0, 4.4);
        const bed3W = wallV(9.0, 0, 4.4);
        const bathSplit = wallH(2.4, 4.0, 5.8);
        const kitW = wallV(7.0, 5.6, 10);
        const kitE = wallV(9.8, 5.6, 10);
        f.walls.push(...s.all, passN, passS, mBathW, mBathE, bed3W, bathSplit, kitW, kitE);

        f.doors.push(
          doorX(s.bottom, 2.0, 1.1), // main entrance
          doorX(passN, 2.8),
          doorY(mBathW, 1.2, 0.75),
          doorX(passN, 4.9, 0.75),
          doorX(passN, 6.6),
          doorX(passN, 10.2),
          doorX(passS, 1.6, 1.2),
          doorX(passS, 8.2),
          doorY(kitE, 7.6, 0.8),
        );
        f.windows.push(
          winX(s.top, 1.8, 2.0),
          winX(s.top, 4.9, 0.9, 1.5, 0.8),
          winX(s.top, 7.2, 1.6),
          winX(s.top, 10.6, 1.6),
          winY(s.left, 2.2, 1.4),
          winY(s.left, 7.6, 1.8),
          winX(s.bottom, 5.2, 2.4),
          winY(s.right, 2.4, 1.4),
          winY(s.right, 7.4, 1.6),
        );

        f.rooms.push(
          rect('Master Bedroom', 0, 0, 4.0, 4.4, 'bedroom'),
          rect('Master Bathroom', 4.0, 0, 5.8, 2.4, 'bath', 'stone-marble'),
          rect('Common Bathroom', 4.0, 2.4, 5.8, 4.4, 'bath', 'stone-marble'),
          rect('Bedroom 2', 5.8, 0, 9.0, 4.4, 'bedroom'),
          rect('Kids Bedroom', 9.0, 0, 12, 4.4, 'bedroom'),
          rect('Passage', 0, 4.4, 12, 5.6, 'hall'),
          rect('Living & Dining', 0, 5.6, 7.0, 10, 'living'),
          rect('Kitchen', 7.0, 5.6, 9.8, 10, 'kitchen', 'stone-marble'),
          rect('Utility & Balcony', 9.8, 5.6, 12, 10, 'utility', 'stone-slate'),
        );

        f.objects.push(
          // Master bedroom
          north('bedroom-king-bed', 1.5, 0, '#cfc4b4'),
          north('bedroom-nightstand', 0.3, 0),
          north('bedroom-nightstand', 2.7, 0),
          west('bedroom-wardrobe', 0, 3.3),
          east('bedroom-dressing-table', 4.0, 3.4),
          north('living-split-ac', 3.3, 0),
          place('living-ceiling-fan', 1.8, 2.2),

          // Master bathroom
          north('bathroom-toilet', 5.5, 0),
          north('bathroom-basin-sink', 4.7, 0),
          north('bathroom-mirror', 4.7, 0),
          place('bathroom-shower', 5.3, 1.95),
          east('bathroom-water-heater', 5.8, 2.1),

          // Common bathroom
          west('bathroom-toilet', 4.0, 3.0),
          east('bathroom-basin-sink', 5.8, 2.9),
          east('bathroom-mirror', 5.8, 2.9),

          // Bedroom 2
          north('bedroom-queen-bed', 7.6, 0, '#d8cfc2'),
          north('bedroom-nightstand', 6.45, 0),
          north('bedroom-nightstand', 8.7, 0),
          east('bedroom-wardrobe', 9.0, 3.2),
          west('bedroom-study-table', 5.8, 3.0),
          place('office-office-chair', 6.8, 3.0, -Math.PI / 2),
          north('living-split-ac', 8.6, 0),
          place('living-ceiling-fan', 7.4, 2.2),

          // Kids bedroom
          north('bedroom-bunk-bed', 9.6, 0),
          north('bedroom-wardrobe', 11.0, 0),
          east('bedroom-study-table', 12, 2.6),
          place('office-office-chair', 11.1, 2.6, Math.PI / 2),
          west('living-bookshelf', 9.0, 3.6),
          north('living-split-ac', 9.8, 0),
          place('living-ceiling-fan', 10.5, 2.4),

          // Living & dining
          west('living-tv-console', 0, 7.6),
          west('living-wall-tv-55-inch', 0, 7.6),
          place('living-l-shaped-sofa', 2.8, 7.6, Math.PI / 2, '#5b8db8'),
          place('living-coffee-table', 1.3, 7.6, Math.PI / 2),
          place('living-rug', 1.6, 7.6, Math.PI / 2, '#8f8577'),
          place('dining-dining-table-6-seat', 5.3, 7.2),
          place('dining-dining-chair', 4.6, 6.4),
          place('dining-dining-chair', 5.3, 6.4),
          place('dining-dining-chair', 6.0, 6.4),
          place('dining-dining-chair', 4.6, 8.0, Math.PI),
          place('dining-dining-chair', 5.3, 8.0, Math.PI),
          place('dining-dining-chair', 6.0, 8.0, Math.PI),
          west('decoration-pooja-unit', 0, 9.35),
          east('dining-crockery-unit', 7.0, 8.6),
          south('living-shoe-rack', 3.4, 10),
          place('living-floor-plant', 5.8, 9.4),
          place('living-ceiling-fan', 4.0, 7.8),
          place('lighting-floor-lamp', 0.5, 6.0),

          // Kitchen
          west('kitchen-kitchen-cabinet', 7.0, 7.4),
          west('kitchen-kitchen-sink', 7.0, 8.7),
          west('kitchen-microwave', 7.0, 6.0),
          south('kitchen-oven-range', 8.4, 10),
          south('kitchen-chimney-hood', 8.4, 10),
          south('kitchen-dishwasher', 7.5, 10),
          east('kitchen-refrigerator', 9.8, 6.3),
          east('kitchen-tall-pantry-unit', 9.8, 9.2),

          // Utility & balcony
          east('kitchen-washing-machine', 12, 6.4),
          east('kitchen-kitchen-sink', 12, 8.9),
          place('outdoor-outdoor-table', 10.75, 9.45),
          place('outdoor-outdoor-chair', 10.75, 8.5, Math.PI),
          place('outdoor-potted-tree', 10.8, 6.4),
        );
      }),
  },

  {
    id: 'studio',
    name: 'Studio apartment',
    description: 'One open room with a sleeping corner, sofa, dining spot and kitchen wall.',
    category: 'studio',
    badge: 'Studio',
    bedrooms: 0,
    bathrooms: 0,
    highlights: ['Single open room', 'Everything within a few steps', 'Easiest plan to re-arrange'],
    bestFor: 'A first project, or a compact city flat',
    build: () =>
      withFloor(createProject('Studio Apartment'), (f) => {
        const s = shell(0, 0, 6, 8);
        f.walls.push(...s.all);
        f.doors.push(doorY(s.right, 6.9, 1.0));
        f.windows.push(winX(s.top, 2.0, 1.8), winY(s.right, 2.2, 1.6), winY(s.right, 5.4, 1.6));
        f.rooms.push(rect('Studio', 0, 0, 6, 8, 'living'));

        f.objects.push(
          north('bedroom-queen-bed', 1.2, 0, '#d8cfc2'),
          north('bedroom-nightstand', 2.4, 0),
          north('bedroom-wardrobe', 4.6, 0),
          east('living-sofa-3-seat', 6, 4.2, '#6f7482'),
          place('living-coffee-table', 3.2, 4.2, Math.PI / 2),
          place('living-rug', 3.4, 4.2, Math.PI / 2, '#8f8577'),
          west('living-tv-unit', 0, 4.2),
          west('living-wall-tv-55-inch', 0, 4.2),
          place('dining-dining-table-round', 4.6, 6.6),
          place('dining-dining-chair', 4.6, 5.8, Math.PI),
          place('dining-dining-chair', 4.6, 7.4),
          south('kitchen-kitchen-cabinet', 3.5, 8),
          west('kitchen-refrigerator', 0, 6.6),
          south('kitchen-oven-range', 2.2, 8),
          south('kitchen-chimney-hood', 2.2, 8),
          west('kitchen-kitchen-sink', 0, 7.5),
          place('living-floor-plant', 5.7, 1.7),
          place('living-ceiling-fan', 3.0, 4.0),
        );
      }),
  },

  {
    id: 'one-bed',
    name: 'One-bedroom flat',
    description: 'Living room, separate bedroom and bathroom joined by a short hall.',
    category: '1bhk',
    badge: '1 BHK',
    bedrooms: 1,
    bathrooms: 1,
    highlights: ['Generous living room', 'Bedroom tucked behind the hall', 'Compact 9 × 7 m footprint'],
    bestFor: 'Comparing a hall-based layout against the open 1 BHK',
    build: () =>
      withFloor(createProject('One-Bedroom Flat'), (f) => {
        const s = shell(0, 0, 9, 7);
        const bedWall = wallV(5.2, 0, 4.2);
        const hallN = wallH(4.2, 5.2, 9);
        const bathW = wallV(6.6, 4.2, 7);
        f.walls.push(...s.all, bedWall, hallN, bathW);

        f.doors.push(doorX(s.bottom, 5.9, 1.0), doorY(bedWall, 3.0), doorY(bathW, 5.4, 0.8));
        f.windows.push(winX(s.top, 1.4, 2.0), winX(s.top, 6.4, 1.6), winY(s.right, 1.6, 1.4), winY(s.left, 3.6, 1.4));

        f.rooms.push(
          rect('Living & Dining', 0, 0, 5.2, 7, 'living'),
          rect('Bedroom', 5.2, 0, 9, 4.2, 'bedroom'),
          rect('Bathroom', 6.6, 4.2, 9, 7, 'bath', 'stone-marble'),
          rect('Hall', 5.2, 4.2, 6.6, 7, 'hall'),
        );

        f.objects.push(
          place('living-l-shaped-sofa', 1.8, 2.4, 0, '#5b8db8'),
          place('living-coffee-table', 3.75, 2.9),
          place('living-rug', 2.6, 2.9, 0, '#8f8577'),
          east('living-tv-unit', 5.2, 1.6),
          east('living-wall-tv-55-inch', 5.2, 1.6),
          west('living-bookshelf', 0, 5.4),
          place('dining-dining-table-rect', 2.6, 5.6),
          place('dining-dining-chair', 2.0, 4.9),
          place('dining-dining-chair', 3.2, 4.9),
          place('dining-dining-chair', 2.0, 6.3, Math.PI),
          place('dining-dining-chair', 3.2, 6.3, Math.PI),
          place('lighting-floor-lamp', 0.4, 0.5),
          north('bedroom-king-bed', 7.1, 0, '#cfc4b4'),
          north('bedroom-nightstand', 5.9, 0),
          north('bedroom-nightstand', 8.3, 0),
          south('bedroom-wardrobe', 7.1, 4.2),
          north('living-split-ac', 8.6, 0),
          place('living-ceiling-fan', 7.1, 2.1),
          south('bathroom-toilet', 8.6, 7),
          east('bathroom-basin-sink', 9, 5.0),
          east('bathroom-mirror', 9, 5.0),
          place('bathroom-shower', 7.1, 6.5),
          place('living-floor-plant', 4.8, 6.5),
          place('living-ceiling-fan', 2.6, 3.4),
        );
      }),
  },

  {
    id: 'kitchen-living',
    name: 'Open-plan kitchen & living',
    description: 'Island kitchen flowing into a lounge — good for testing materials and lighting.',
    category: 'room',
    badge: 'Room',
    bedrooms: 0,
    bathrooms: 0,
    highlights: ['One island kitchen and one lounge', 'No bedrooms — a room study, not a home', 'Heavy on appliances'],
    bestFor: 'Trying finishes and lighting on a single space',
    build: () =>
      withFloor(createProject('Kitchen & Living'), (f) => {
        const s = shell(0, 0, 8, 6);
        f.walls.push(...s.all);
        f.doors.push(doorY(s.left, 3.0, 1.0));
        f.windows.push(winX(s.top, 2.0, 2.4), winX(s.top, 6.0, 2.4), winY(s.right, 2.8, 2.2));
        f.rooms.push(
          rect('Kitchen', 0, 0, 3.6, 6, 'kitchen', 'stone-marble'),
          rect('Living', 3.6, 0, 8, 6, 'living'),
        );

        f.objects.push(
          west('kitchen-kitchen-cabinet', 0, 1.6, '#b3a58c'),
          west('kitchen-kitchen-sink', 0, 5.4),
          north('kitchen-refrigerator', 1.4, 0),
          west('kitchen-oven-range', 0, 4.3),
          west('kitchen-chimney-hood', 0, 4.3),
          place('kitchen-kitchen-island', 2.2, 3.0, Math.PI / 2),
          place('kitchen-bar-stool', 2.95, 2.3, Math.PI / 2),
          place('kitchen-bar-stool', 2.95, 3.0, Math.PI / 2),
          place('kitchen-bar-stool', 2.95, 3.7, Math.PI / 2),
          place('lighting-pendant-light', 2.2, 2.5),
          place('lighting-pendant-light', 2.2, 3.5),
          south('living-sofa-3-seat', 5.9, 6, '#7c8290'),
          east('living-armchair', 8, 3.2, '#8a6f61'),
          place('living-coffee-table', 5.9, 3.5),
          place('living-rug', 5.9, 3.8, 0, '#8f8577'),
          north('living-tv-unit', 5.9, 0),
          north('living-wall-tv-55-inch', 5.9, 0),
          place('living-floor-plant', 7.5, 0.6),
          place('lighting-floor-lamp', 4.2, 5.5),
          place('living-ceiling-fan', 5.9, 3.0),
        );
      }),
  },
];

/**
 * Two-storey 3 BHK with a real staircase — the plan the walkthrough's
 * acceptance scenario describes: living room, sofa, dining, kitchen and a
 * bathroom downstairs; walk up the stairs to the bedrooms and bathroom above.
 */
function buildDuplex(): Project {
  const project = createProject('Duplex 3 BHK');
  project.floors[0].name = 'Ground Floor';
  project.floorHeight = 3;
  project.floors[0].height = 3;

  withFloor(project, (f) => {
    const s = shell(0, 0, 10, 8);
    const kitWall = wallV(6, 0, 4);
    const bathTop = wallH(5, 0, 2.5);
    const bathSide = wallV(2.5, 5, 8);
    f.walls.push(...s.all, kitWall, bathTop, bathSide);

    f.doors.push(
      doorX(s.bottom, 5.0, 1.0), // main entrance
      doorY(kitWall, 1.0, 0.9), // kitchen
      doorX(bathTop, 1.7, 0.8), // bathroom
    );
    f.windows.push(winX(s.top, 3.5, 1.8), winX(s.top, 8.0, 1.4), winY(s.right, 2.0, 1.2), winY(s.right, 6.0, 1.6), winX(s.bottom, 8.0, 1.8), winY(s.left, 6.6, 0.9, 1.4, 0.8));

    f.rooms.push(
      room('Living & Dining', [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 4 },
        { x: 10, y: 4 },
        { x: 10, y: 8 },
        { x: 2.5, y: 8 },
        { x: 2.5, y: 5 },
        { x: 0, y: 5 },
      ], 'living'),
      rect('Kitchen', 6, 0, 10, 4, 'kitchen', 'stone-marble-white'),
      rect('Bathroom', 0, 5, 2.5, 8, 'bath', 'tile-white'),
    );

    f.objects.push(
      // Staircase along the west wall: bottom step to the south, climbing north.
      place('structure-straight-staircase', 0.75, 2.4),
      // Living
      north('living-tv-unit', 3.6, 0),
      north('living-wall-tv-55-inch', 3.6, 0),
      place('living-sofa-3-seat', 3.6, 3.3, Math.PI),
      place('living-coffee-table', 3.6, 2.1),
      place('living-rug', 3.6, 2.2, 0, '#8f8577'),
      place('living-armchair', 5.0, 3.3, -Math.PI / 2),
      place('living-floor-plant', 5.6, 4.6),
      place('living-ceiling-fan', 3.6, 2.2),
      west('living-shoe-rack', 2.5, 7.4),
      // Dining
      place('dining-dining-table-6-seat', 8.0, 6.0),
      place('dining-dining-chair', 7.3, 5.3),
      place('dining-dining-chair', 8.7, 5.3),
      place('dining-dining-chair', 7.3, 6.7, Math.PI),
      place('dining-dining-chair', 8.7, 6.7, Math.PI),
      east('dining-crockery-unit', 10, 4.9),
      place('lighting-pendant-light', 8.0, 6.0),
      // Kitchen
      north('kitchen-kitchen-sink', 8.0, 0),
      north('kitchen-chimney-hood', 9.1, 0),
      north('kitchen-oven-range', 9.1, 0),
      east('kitchen-refrigerator', 10, 1.4),
      west('kitchen-kitchen-cabinet', 6, 3.2),
      place('kitchen-kitchen-island', 8.0, 2.4),
      // Bathroom
      west('bathroom-toilet', 0, 7.4),
      east('bathroom-basin-sink', 2.5, 6.0),
      place('bathroom-shower', 1.9, 7.4),
      west('bathroom-mirror', 0, 6.2),
    );
  });

  withUpperFloor(project, 'First Floor', (f) => {
    const s = shell(0, 0, 10, 8);
    const landingWall = wallV(2.5, 0, 8);
    const midWall = wallH(4, 2.5, 10);
    const bathWall = wallV(6.5, 4, 8);
    f.walls.push(...s.all, landingWall, midWall, bathWall);

    f.doors.push(
      doorY(landingWall, 2.0, 0.9), // master bedroom
      doorY(landingWall, 6.0, 0.9), // bedroom 2
      doorX(midWall, 8.25, 0.8), // en-suite from the master bedroom
    );
    f.windows.push(winX(s.top, 6.0, 2.0), winY(s.right, 2.0, 1.4), winY(s.right, 6.0, 1.0, 1.4, 0.8), winX(s.bottom, 4.5, 1.8), winY(s.left, 6.0, 1.2));

    f.rooms.push(
      rect('Landing', 0, 0, 2.5, 8, 'hall'),
      rect('Master Bedroom', 2.5, 0, 10, 4, 'bedroom'),
      rect('Bedroom 2', 2.5, 4, 6.5, 8, 'bedroom'),
      rect('Bathroom', 6.5, 4, 10, 8, 'bath', 'tile-white'),
    );

    f.objects.push(
      // Master bedroom
      north('bedroom-king-bed', 6.0, 0),
      north('bedroom-nightstand', 4.7, 0),
      north('bedroom-nightstand', 7.3, 0),
      south('bedroom-wardrobe', 4.6, 4),
      east('bedroom-dressing-table', 10, 3.0),
      place('living-ceiling-fan', 6.0, 2.0),
      // Bedroom 2
      east('bedroom-single-bed', 6.5, 6.6),
      west('bedroom-study-table', 2.5, 4.7),
      place('office-office-chair', 3.6, 4.7, Math.PI / 2),
      north('bedroom-wardrobe', 5.2, 4),
      // Bathroom
      east('bathroom-toilet', 10, 7.4),
      south('bathroom-basin-sink', 8.0, 8),
      place('bathroom-shower', 7.1, 4.6),
      // Landing
      place('living-floor-plant', 1.2, 7.3),
    );
  });

  // Start the walkthrough just inside the front door, facing the living room.
  project.walkthrough = {
    spawns: [{ id: 'spawn-entrance', name: 'Entrance', floorId: project.floors[0].id, x: 5.0, z: 7.0, yaw: 0 }],
    startSpawnId: 'spawn-entrance',
  };
  return project;
}

TEMPLATES.push({
  id: 'duplex',
  name: 'Duplex 3 BHK with stairs',
  description:
    'Two storeys: living-dining, kitchen and a bathroom downstairs; a landing, master bedroom with en-suite, second bedroom and bathroom upstairs. Walk up the stairs in the walkthrough.',
  category: 'duplex',
  badge: 'Duplex',
  bedrooms: 2,
  bathrooms: 2,
  highlights: ['A real staircase connecting the two floors', 'Open living-dining with the kitchen off it', 'Walkthrough starts at the front door'],
  bestFor: 'Trying the first-person walkthrough end to end, or a two-storey home',
  build: buildDuplex,
});

export const templateById = (id: string): ProjectTemplate | undefined => TEMPLATES.find((t) => t.id === id);

/** Filter chips for the gallery, in display order. */
export const TEMPLATE_FILTERS: { id: TemplateCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All plans' },
  { id: '1bhk', label: '1 BHK' },
  { id: '2bhk', label: '2 BHK' },
  { id: '3bhk', label: '3 BHK' },
  { id: 'duplex', label: 'Duplex' },
  { id: 'studio', label: 'Studio' },
  { id: 'room', label: 'Single room' },
  { id: 'blank', label: 'Blank' },
];
