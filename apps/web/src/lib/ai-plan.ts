/**
 * Plans authored by an AI, in a shape an AI can write.
 *
 * Neither a language model behind an API key nor an MCP client (Claude
 * Desktop, Cursor, Codex) should have to produce the canonical `Project`
 * verbatim: it has generated ids, wall-relative door offsets and catalog
 * dimensions baked into every object. `PlanSpec` is the friendlier contract —
 * walls as coordinate pairs, doors by distance along a wall, furniture by
 * catalog id and position — and `planSpecToProject` turns it into a real,
 * validated project. Anything the model invents (unknown furniture, a door on
 * a wall that does not exist) is dropped and reported, never written.
 */

import type { Door, Floor, Project, ProjectObject, Room, Wall, Window, DoorBehavior } from '@interior/core';
import { createFloor, createProject, wallLength, polygonArea, analyseFloor } from '@interior/core';
import { FURNITURE_LIBRARY, assetById, searchAssets, keywordToAssets } from './furniture';

export interface PlanWallSpec {
  /** Optional handle the spec can refer to from doors and windows. */
  id?: string | null;
  a: [number, number];
  b: [number, number];
  thickness?: number | null;
  height?: number | null;
}

export interface PlanRoomSpec {
  name: string;
  points: [number, number][];
  /** living | bedroom | kitchen | bath | dining | hall | utility — picks the floor colour. */
  kind?: string | null;
}

export interface PlanOpeningSpec {
  /** Wall id (from `PlanWallSpec.id`) or the wall's index in the floor's `walls` array. */
  wall: string | number;
  /** Distance along the wall from its `a` end to the centre of the opening, metres. */
  at: number;
  width?: number | null;
  height?: number | null;
  /** Windows only: sill height. */
  sill?: number | null;
  /** Doors only. */
  behavior?: DoorBehavior | null;
}

export interface PlanObjectSpec {
  /** Catalog asset id (preferred) or a name / keyword such as "sofa". */
  asset: string;
  x: number;
  z: number;
  rotationDeg?: number | null;
  color?: string | null;
}

export interface PlanFloorSpec {
  name: string;
  walls: PlanWallSpec[];
  rooms: PlanRoomSpec[];
  doors: PlanOpeningSpec[];
  windows: PlanOpeningSpec[];
  objects: PlanObjectSpec[];
}

export interface PlanSpec {
  name: string;
  /** Metres. Defaults to 3. Each floor is stacked at index × floorHeight. */
  floorHeight?: number | null;
  floors: PlanFloorSpec[];
  /** Where the walkthrough starts: floor index + plan position + heading (0 = north). */
  start?: { floor: number; x: number; z: number; yawDeg?: number | null } | null;
}

export interface PlanConversion {
  project: Project;
  /** Human-readable notes about anything that was skipped or adjusted. */
  notes: string[];
  /** Collision warnings from the same engine the editor uses. */
  warnings: string[];
}

const ROOM_COLORS: Record<string, string> = {
  living: '#4a68a6',
  bedroom: '#6b5b95',
  bath: '#4a8a9a',
  bathroom: '#4a8a9a',
  kitchen: '#8a7a4a',
  utility: '#5f7a63',
  hall: '#8a8a80',
  landing: '#8a8a80',
  corridor: '#8a8a80',
  dining: '#5b7a8a',
  office: '#7a6a8a',
  balcony: '#5f7a63',
};

const rnd = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function roomKindOf(name: string, kind: string | null | undefined): string {
  const k = (kind ?? '').toLowerCase();
  if (ROOM_COLORS[k]) return k;
  const n = name.toLowerCase();
  for (const key of Object.keys(ROOM_COLORS)) if (n.includes(key)) return key;
  if (/bed|master|guest|kids/.test(n)) return 'bedroom';
  if (/toilet|wash|shower|bath|wc/.test(n)) return 'bath';
  if (/kitchen|pantry/.test(n)) return 'kitchen';
  if (/dining/.test(n)) return 'dining';
  if (/office|study/.test(n)) return 'office';
  return 'living';
}

/** Finds a catalog asset by id, exact name, or a keyword. */
export function resolveAsset(key: string) {
  const direct = assetById(key);
  if (direct) return direct;
  const k = key.trim().toLowerCase();
  const byName = FURNITURE_LIBRARY.find((a) => a.name.toLowerCase() === k);
  if (byName) return byName;
  // The assistant's keyword table knows synonyms ("couch", "fridge", "geyser").
  const keyed = keywordToAssets[k]?.map((id) => assetById(id)).find(Boolean);
  if (keyed) return keyed;
  const hits = searchAssets(k, null);
  return hits[0] ?? null;
}

function isPair(p: unknown): p is [number, number] {
  return Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * Builds a canonical project from a spec. Never throws on bad content: the
 * result carries notes explaining every omission so the person (or the AI on
 * the other side of an MCP call) can fix the spec and try again.
 */
export function planSpecToProject(spec: PlanSpec, options: { id?: string } = {}): PlanConversion {
  const notes: string[] = [];
  const project = createProject((spec.name || 'AI plan').toString().slice(0, 80));
  if (options.id) project.id = options.id;
  const floorHeight = clamp(num(spec.floorHeight, 3), 2.2, 6);
  project.floorHeight = floorHeight;
  project.floors = [];

  const floorsIn = Array.isArray(spec.floors) && spec.floors.length ? spec.floors : [];
  if (!floorsIn.length) notes.push('The spec had no floors; an empty ground floor was created.');

  (floorsIn.length ? floorsIn : [{ name: 'Ground Floor', walls: [], rooms: [], doors: [], windows: [], objects: [] }]).slice(0, 10).forEach((fs, index) => {
    const floor = createFloor((fs.name || (index === 0 ? 'Ground Floor' : `Floor ${index + 1}`)).toString().slice(0, 40));
    floor.height = floorHeight;
    floor.elevation = r3(index * floorHeight);
    fillFloor(floor, fs, floorHeight, notes);
    project.floors.push(floor);
  });

  // Walkthrough start, if the spec asked for one.
  if (spec.start && typeof spec.start === 'object') {
    const f = project.floors[clamp(Math.round(num(spec.start.floor, 0)), 0, project.floors.length - 1)];
    if (f && Number.isFinite(spec.start.x) && Number.isFinite(spec.start.z)) {
      project.walkthrough = {
        spawns: [{ id: 'spawn-start', name: 'Start', floorId: f.id, x: r3(spec.start.x), z: r3(spec.start.z), yaw: r3((num(spec.start.yawDeg, 0) * Math.PI) / 180) }],
        startSpawnId: 'spawn-start',
      };
    }
  }

  project.updatedAt = Date.now();
  const warnings = project.floors.flatMap((f) => analyseFloor(f).filter((w) => w.level === 'error').map((w) => `${f.name}: ${w.message}`));
  return { project, notes, warnings };
}

function fillFloor(floor: Floor, fs: PlanFloorSpec, floorHeight: number, notes: string[]): void {
  const wallByKey = new Map<string, Wall>();
  const walls: Wall[] = [];
  (Array.isArray(fs.walls) ? fs.walls : []).forEach((w, i) => {
    if (!isPair(w?.a) || !isPair(w?.b)) {
      notes.push(`${floor.name}: wall ${i + 1} skipped (needs a and b as [x, y]).`);
      return;
    }
    const wall: Wall = {
      id: rnd('wall'),
      a: { x: r3(w.a[0]), y: r3(w.a[1]) },
      b: { x: r3(w.b[0]), y: r3(w.b[1]) },
      thickness: clamp(num(w.thickness, 0.15), 0.04, 0.6),
      height: clamp(num(w.height, floorHeight), 1.2, 6),
      color: '#e8e6e1',
      materialId: null,
    };
    if (wallLength(wall) < 0.05) {
      notes.push(`${floor.name}: wall ${i + 1} skipped (zero length).`);
      return;
    }
    walls.push(wall);
    wallByKey.set(String(i), wall);
    if (w.id) wallByKey.set(String(w.id), wall);
  });
  floor.walls = walls;

  floor.rooms = (Array.isArray(fs.rooms) ? fs.rooms : []).flatMap((r, i): Room[] => {
    const pts = Array.isArray(r?.points) ? r.points.filter(isPair) : [];
    if (pts.length < 3) {
      notes.push(`${floor.name}: room "${r?.name ?? i + 1}" skipped (needs at least 3 points).`);
      return [];
    }
    const kind = roomKindOf(String(r.name ?? ''), r.kind);
    return [{ id: rnd('room'), name: String(r.name ?? `Room ${i + 1}`).slice(0, 40), points: pts.map((p) => ({ x: r3(p[0]), y: r3(p[1]) })), color: ROOM_COLORS[kind], materialId: kind === 'bath' || kind === 'bathroom' ? 'tile-white' : kind === 'kitchen' ? 'stone-marble-white' : 'wood-oak' }];
  });

  const opening = (o: PlanOpeningSpec, kind: 'door' | 'window', defaultWidth: number) => {
    const wall = wallByKey.get(String(o?.wall));
    if (!wall) {
      notes.push(`${floor.name}: ${kind} skipped (wall "${o?.wall}" not found).`);
      return null;
    }
    const len = wallLength(wall);
    const width = clamp(num(o.width, defaultWidth), kind === 'door' ? 0.6 : 0.4, Math.max(0.6, Math.min(len, 3)));
    if (width > len) {
      notes.push(`${floor.name}: ${kind} skipped (wider than its wall).`);
      return null;
    }
    const offset = r3(clamp(num(o.at, len / 2) - width / 2, 0, len - width));
    return { wall, width, offset };
  };

  floor.doors = (Array.isArray(fs.doors) ? fs.doors : []).flatMap((d): Door[] => {
    const o = opening(d, 'door', 0.9);
    if (!o) return [];
    const behavior = d.behavior && ['manual', 'automatic', 'open', 'locked'].includes(d.behavior) ? d.behavior : null;
    return [{ id: rnd('door'), kind: 'door', wallId: o.wall.id, offset: o.offset, width: r3(o.width), height: clamp(num(d.height, 2.1), 1.8, 3), swing: 1, ...(behavior ? { metadata: { doorBehavior: behavior } } : {}) }];
  });

  floor.windows = (Array.isArray(fs.windows) ? fs.windows : []).flatMap((w): Window[] => {
    const o = opening(w, 'window', 1.2);
    if (!o) return [];
    const sill = clamp(num(w.sill, 0.9), 0.1, 1.8);
    return [{ id: rnd('win'), kind: 'window', wallId: o.wall.id, offset: o.offset, width: r3(o.width), height: clamp(num(w.height, sill + 1.2), sill + 0.3, 3), sill }];
  });

  floor.objects = (Array.isArray(fs.objects) ? fs.objects : []).slice(0, 150).flatMap((o, i): ProjectObject[] => {
    const asset = typeof o?.asset === 'string' ? resolveAsset(o.asset) : null;
    if (!asset) {
      notes.push(`${floor.name}: object ${i + 1} skipped (unknown furniture "${o?.asset}").`);
      return [];
    }
    if (!Number.isFinite(o.x) || !Number.isFinite(o.z)) {
      notes.push(`${floor.name}: ${asset.name} skipped (needs x and z).`);
      return [];
    }
    const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : asset.color;
    return [
      {
        id: rnd('obj'),
        assetId: asset.id,
        name: asset.name,
        shape: asset.shape,
        x: r3(o.x),
        z: r3(o.z),
        rotation: r3((num(o.rotationDeg, 0) * Math.PI) / 180),
        scale: 1,
        width: asset.width,
        depth: asset.depth,
        // A staircase climbs exactly one storey.
        height: asset.shape === 'stairs' ? floorHeight : asset.height,
        color,
        materialId: null,
        ...(asset.mounted ? { metadata: { mounted: true } } : {}),
      },
    ];
  });
}

/** Compact catalog for a prompt or a tool listing: id, name, footprint. */
export function catalogForPrompt(): { id: string; name: string; category: string; w: number; d: number; h: number; mounted?: boolean }[] {
  return FURNITURE_LIBRARY.map((a) => ({ id: a.id, name: a.name, category: a.category, w: a.width, d: a.depth, h: a.height, ...(a.mounted ? { mounted: true } : {}) }));
}

/** JSON Schema for `PlanSpec`, strict enough for structured-output modes on both providers. */
export const PLAN_SPEC_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'floorHeight', 'floors', 'start'],
  properties: {
    name: { type: 'string' },
    floorHeight: { type: 'number' },
    floors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'walls', 'rooms', 'doors', 'windows', 'objects'],
        properties: {
          name: { type: 'string' },
          walls: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'a', 'b', 'thickness', 'height'],
              properties: {
                id: { type: 'string' },
                a: { type: 'array', items: { type: 'number' } },
                b: { type: 'array', items: { type: 'number' } },
                thickness: { type: 'number' },
                height: { type: 'number' },
              },
            },
          },
          rooms: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'kind', 'points'],
              properties: {
                name: { type: 'string' },
                kind: { type: 'string' },
                points: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
              },
            },
          },
          doors: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['wall', 'at', 'width', 'behavior'],
              properties: {
                wall: { type: 'string' },
                at: { type: 'number' },
                width: { type: 'number' },
                behavior: { type: 'string', enum: ['manual', 'automatic', 'open', 'locked'] },
              },
            },
          },
          windows: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['wall', 'at', 'width', 'sill', 'height'],
              properties: {
                wall: { type: 'string' },
                at: { type: 'number' },
                width: { type: 'number' },
                sill: { type: 'number' },
                height: { type: 'number' },
              },
            },
          },
          objects: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['asset', 'x', 'z', 'rotationDeg'],
              properties: {
                asset: { type: 'string' },
                x: { type: 'number' },
                z: { type: 'number' },
                rotationDeg: { type: 'number' },
              },
            },
          },
        },
      },
    },
    start: {
      type: 'object',
      additionalProperties: false,
      required: ['floor', 'x', 'z', 'yawDeg'],
      properties: {
        floor: { type: 'integer' },
        x: { type: 'number' },
        z: { type: 'number' },
        yawDeg: { type: 'number' },
      },
    },
  },
} as const;

/** The rules every AI author gets, whichever door it comes through. */
export const PLAN_AUTHORING_GUIDE = `You design residential floor plans for an interior-design studio. Output ONE PlanSpec JSON object.

Coordinate system: metres, plan view. x runs east (right), y runs south (down the page). The origin is the top-left of the footprint. Keep every coordinate between 0 and 40.

Walls: straight segments from a to b, each with a unique short id (w1, w2, …). Draw the outer shell as four walls (thickness 0.2) and interior partitions (thickness 0.12–0.15). Walls must meet at shared endpoints; no gaps or overlaps. Every room must be fully enclosed by walls except deliberate open-plan areas.

Rooms: one closed polygon per room, listed clockwise, lying exactly on the wall centrelines. kind is one of living, bedroom, kitchen, bath, dining, hall, utility, office, balcony.

Doors: on a wall id, "at" = distance from that wall's a end to the door centre; width 0.8–1.0 (entrance 1.0). Every room needs a door; one door on the shell is the entrance. Windows: on exterior walls only, width 1.0–2.0, sill 0.9, height 1.5 (height is the top of the glass from the floor; use sill 0.9 and height 2.4 for a typical window).

Furniture: use catalog ids exactly as given in the catalog list. Position is the footprint centre; rotationDeg turns clockwise, and a piece's back faces its -depth side, so a sofa against a north wall uses rotationDeg 0, against a south wall 180, against a west wall -90, east wall 90. Keep at least 0.3 m from walls (measure from the centre: half the depth + 0.3), leave 0.8 m walkways, never overlap pieces, never block doors (keep 1 m clear in front of every door). Furnish every room appropriately (beds, wardrobes, nightstands in bedrooms; sofa, coffee table, TV unit in living rooms; dining table with chairs; kitchen sink, oven, fridge, cabinets; toilet, basin, shower in bathrooms).

Multiple floors: stack floors with the same shell. Put a 'structure-straight-staircase' on the lower floor (width 1, depth 3.2) with its back (-depth, the top step) towards the direction of travel; leave the same footprint empty on the floor above (no furniture there) and keep that area inside a landing room.

start: a point just inside the entrance door, yawDeg facing into the home (0 = north/up, 90 = west, 180 = south, -90 = east).`;

/** Tolerant JSON extraction: a fenced block or leading prose is forgiven. */
export function extractJsonObject(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object in the response');
  return JSON.parse(t.slice(start, end + 1));
}

/** One-paragraph description plus per-floor counts, for an AI reading back what it built. */
export function summarizeProject(project: Project): string {
  const lines = [`Project "${project.name}" (${project.id}) — ${project.floors.length} floor(s), floor height ${project.floorHeight} m.`];
  for (const f of project.floors) {
    const area = f.rooms.reduce((s, r) => s + Math.abs(polygonArea(r.points)), 0);
    lines.push(`• ${f.name} (id ${f.id}, elevation ${f.elevation} m): ${f.walls.length} walls, ${f.rooms.length} rooms (${area.toFixed(1)} m²), ${f.doors.length} doors, ${f.windows.length} windows, ${f.objects.length} objects.`);
    for (const r of f.rooms) lines.push(`    room ${r.id} "${r.name}" ${Math.abs(polygonArea(r.points)).toFixed(1)} m² — ${r.points.map((p) => `(${p.x},${p.y})`).join(' ')}`);
    for (const w of f.walls) lines.push(`    wall ${w.id} (${w.a.x},${w.a.y})→(${w.b.x},${w.b.y}) t=${w.thickness}`);
    for (const d of f.doors) lines.push(`    door ${d.id} on ${d.wallId} offset ${d.offset} width ${d.width}`);
    for (const w of f.windows) lines.push(`    window ${w.id} on ${w.wallId} offset ${w.offset} width ${w.width}`);
    for (const o of f.objects) lines.push(`    object ${o.id} ${o.name} [${o.assetId}] at (${o.x},${o.z}) rot ${Math.round((o.rotation * 180) / Math.PI)}°`);
  }
  if (project.walkthrough?.spawns.length) {
    const s = project.walkthrough.spawns[0];
    lines.push(`• Walkthrough start at (${s.x},${s.z}) on floor ${s.floorId}.`);
  }
  return lines.join('\n');
}
