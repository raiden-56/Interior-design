/**
 * Tools an MCP client (Claude Desktop, Cursor, Codex …) gets to build and edit
 * plans in the studio.
 *
 * Every mutation goes through `applyCommand`, the same command engine the
 * editor uses, so an AI building a house over MCP produces exactly the model a
 * person drawing it would. The transport (stdio JSON-RPC) lives in
 * `tools/mcp-server.mjs`; this module is pure logic so it can be unit-tested.
 */

import type { Command, Project, ProjectObject, Room, Wall, Vec2, DoorBehavior } from '@interior/core';
import { applyCommand, analyseFloor, wallLength, polygonArea, createFloor, closestPointOnSegment } from '@interior/core';
import { TEMPLATES, templateById } from './templates';
import { catalogForPrompt, planSpecToProject, resolveAsset, summarizeProject, PLAN_AUTHORING_GUIDE, type PlanSpec } from './ai-plan';

export interface ProjectStore {
  get(id: string): Promise<Project | null>;
  put(project: Project): Promise<{ synced: boolean; note?: string }>;
  list(): Promise<{ id: string; name: string; updatedAt: number }[]>;
  studioUrl(id: string): string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const rnd = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
const vec = (v: unknown): Vec2 | null => (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? { x: r3(v[0]), y: r3(v[1]) } : null);

const COORDS = 'Plan coordinates in metres: x east, y south (down the page).';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'authoring_guide',
    description: 'Read this first: the coordinate system, how walls, rooms, doors, windows and furniture are described, and the design rules the studio expects.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_catalog',
    description: 'Furniture catalog: asset ids with name, category and footprint (w × d × h metres). Use these ids with place_furniture and in plan specs.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Optional filter on name / category / tag.' } } },
  },
  {
    name: 'list_templates',
    description: 'Ready-made home plans that create_project can start from.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_projects',
    description: 'Projects available in the studio (name, id, last saved).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_project',
    description: 'Create an empty project (one ground floor) or one copied from a template. Returns the project id and its studio URL.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, template: { type: 'string', description: 'Template id from list_templates (e.g. "2bhk", "duplex"). Omit for an empty floor.' } },
      required: ['name'],
    },
  },
  {
    name: 'create_project_from_spec',
    description: `Create a complete project from a PlanSpec in one call: floors with walls, rooms, doors, windows and furniture. ${COORDS} Call authoring_guide for the exact shape and rules. Invalid parts are skipped and reported in the result.`,
    inputSchema: {
      type: 'object',
      properties: { spec: { type: 'object', description: 'A PlanSpec object (see authoring_guide).' } },
      required: ['spec'],
    },
  },
  {
    name: 'get_project',
    description: 'Full description of a project: floors, walls, rooms, doors, windows and objects with their ids and positions.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  },
  {
    name: 'add_floor',
    description: 'Add a floor above the existing ones. Returns the new floor id.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, name: { type: 'string' } }, required: ['projectId'] },
  },
  {
    name: 'add_walls',
    description: `Add straight wall segments to a floor. ${COORDS} Each wall: {a:[x,y], b:[x,y], thickness?, height?}. Returns the new wall ids in order.`,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        floorId: { type: 'string', description: 'Defaults to the first floor.' },
        walls: { type: 'array', items: { type: 'object', properties: { a: { type: 'array', items: { type: 'number' } }, b: { type: 'array', items: { type: 'number' } }, thickness: { type: 'number' }, height: { type: 'number' } }, required: ['a', 'b'] } },
      },
      required: ['projectId', 'walls'],
    },
  },
  {
    name: 'add_rectangular_room',
    description: `Add a rectangular room: four walls plus the room polygon, from its top-left corner (x, y) and size (width east, depth south). ${COORDS} Walls that would duplicate an existing wall on the same line are skipped.`,
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, floorId: { type: 'string' }, name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, depth: { type: 'number' }, kind: { type: 'string', description: 'living | bedroom | kitchen | bath | dining | hall | utility | office' } },
      required: ['projectId', 'name', 'x', 'y', 'width', 'depth'],
    },
  },
  {
    name: 'add_room',
    description: `Add a room polygon (floor slab + name) without walls. ${COORDS}`,
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, floorId: { type: 'string' }, name: { type: 'string' }, points: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, kind: { type: 'string' } },
      required: ['projectId', 'name', 'points'],
    },
  },
  {
    name: 'add_door',
    description: 'Add a door to a wall. Give the wall id, or a point [x,y] and the nearest wall is used. "at" is the distance from the wall\'s a end to the door centre (defaults to the middle).',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, floorId: { type: 'string' }, wallId: { type: 'string' }, near: { type: 'array', items: { type: 'number' } }, at: { type: 'number' }, width: { type: 'number' }, behavior: { type: 'string', enum: ['manual', 'automatic', 'open', 'locked'] } },
      required: ['projectId'],
    },
  },
  {
    name: 'add_window',
    description: 'Add a window to a wall (same addressing as add_door). sill defaults to 0.9 m, height (top of glass) to 2.4 m.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, floorId: { type: 'string' }, wallId: { type: 'string' }, near: { type: 'array', items: { type: 'number' } }, at: { type: 'number' }, width: { type: 'number' }, sill: { type: 'number' }, height: { type: 'number' } },
      required: ['projectId'],
    },
  },
  {
    name: 'place_furniture',
    description: `Place catalog items. ${COORDS} Position is the footprint centre; rotationDeg turns clockwise and the piece's back is its -depth side (0 = back to the north wall, 180 = back to the south wall, -90 west, 90 east).`,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        floorId: { type: 'string' },
        items: { type: 'array', items: { type: 'object', properties: { asset: { type: 'string', description: 'Catalog id (or a name/keyword such as "sofa").' }, x: { type: 'number' }, z: { type: 'number' }, rotationDeg: { type: 'number' }, color: { type: 'string' } }, required: ['asset', 'x', 'z'] } },
      },
      required: ['projectId', 'items'],
    },
  },
  {
    name: 'update_object',
    description: 'Move, rotate, scale or recolour a placed object by id.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, objectId: { type: 'string' }, x: { type: 'number' }, z: { type: 'number' }, rotationDeg: { type: 'number' }, scale: { type: 'number' }, color: { type: 'string' }, materialId: { type: 'string' }, name: { type: 'string' } },
      required: ['projectId', 'objectId'],
    },
  },
  {
    name: 'remove_items',
    description: 'Delete walls, doors, windows, rooms or objects by id (any mix).',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } }, required: ['projectId', 'ids'] },
  },
  {
    name: 'set_walkthrough_start',
    description: 'Where the first-person walkthrough starts. yawDeg: 0 faces north (up the page), 90 west, 180 south, -90 east.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, floorId: { type: 'string' }, x: { type: 'number' }, z: { type: 'number' }, yawDeg: { type: 'number' }, name: { type: 'string' } }, required: ['projectId', 'x', 'z'] },
  },
  {
    name: 'validate_project',
    description: 'Run the studio\'s collision analysis: objects through walls, blocked doors, overlaps, openings off their walls.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  },
  {
    name: 'export_project_json',
    description: 'The project as the JSON file the studio imports (Dashboard → Import), for when the storage service is not running.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  },
  {
    name: 'open_in_studio',
    description: 'The URL that opens the project in the studio editor (and the walkthrough from there).',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  },
];

const ROOM_COLORS: Record<string, string> = { living: '#4a68a6', bedroom: '#6b5b95', bath: '#4a8a9a', kitchen: '#8a7a4a', utility: '#5f7a63', hall: '#8a8a80', dining: '#5b7a8a', office: '#7a6a8a' };

export async function callTool(name: string, args: Record<string, unknown>, store: ProjectStore): Promise<ToolResult> {
  try {
    switch (name) {
      case 'authoring_guide':
        return { text: PLAN_AUTHORING_GUIDE + '\n\nPlanSpec shape:\n' + SPEC_SHAPE };
      case 'list_catalog': {
        const q = str(args.query).toLowerCase();
        const items = catalogForPrompt().filter((a) => !q || a.id.includes(q) || a.name.toLowerCase().includes(q) || a.category.includes(q));
        return { text: items.map((a) => `${a.id} — ${a.name} (${a.category}) ${a.w}×${a.d}×${a.h} m${a.mounted ? ' [wall/ceiling mounted]' : ''}`).join('\n') };
      }
      case 'list_templates':
        return { text: TEMPLATES.map((t) => `${t.id} — ${t.name}: ${t.description}`).join('\n') };
      case 'list_projects': {
        const list = await store.list();
        return { text: list.length ? list.map((p) => `${p.id} — ${p.name} (saved ${new Date(p.updatedAt).toISOString()})`).join('\n') : 'No projects yet.' };
      }
      case 'create_project': {
        const template = args.template ? templateById(str(args.template)) : null;
        if (args.template && !template) return err(`Unknown template "${args.template}". Use list_templates.`);
        const project = template ? template.build() : planSpecToProject({ name: str(args.name, 'New project'), floors: [] }).project;
        project.name = str(args.name, project.name);
        project.updatedAt = Date.now();
        const saved = await store.put(project);
        return { text: `Created project ${project.id} "${project.name}" with ${project.floors.length} floor(s).\nFloor ids: ${project.floors.map((f) => `${f.name}=${f.id}`).join(', ')}\nOpen: ${store.studioUrl(project.id)}${saveNote(saved)}` };
      }
      case 'create_project_from_spec': {
        const spec = args.spec as PlanSpec | undefined;
        if (!spec || typeof spec !== 'object') return err('spec must be a PlanSpec object (see authoring_guide).');
        const { project, notes, warnings } = planSpecToProject(spec);
        const saved = await store.put(project);
        return {
          text: [
            `Created project ${project.id} "${project.name}".`,
            summarizeProject(project),
            notes.length ? `Skipped/adjusted:\n- ${notes.join('\n- ')}` : 'Everything in the spec was accepted.',
            warnings.length ? `Collision warnings:\n- ${warnings.join('\n- ')}` : 'No collision errors.',
            `Open: ${store.studioUrl(project.id)}${saveNote(saved)}`,
          ].join('\n\n'),
        };
      }
      case 'get_project': {
        const p = await need(store, args);
        return { text: summarizeProject(p) };
      }
      case 'add_floor': {
        const p = await need(store, args);
        const below = p.floors[p.floors.length - 1];
        const floor = createFloor(str(args.name, `Floor ${p.floors.length + 1}`));
        floor.height = p.floorHeight;
        floor.elevation = r3(below.elevation + p.floorHeight);
        const next = run(p, { type: 'ADD_FLOOR', floor });
        await store.put(next);
        return { text: `Added floor ${floor.id} "${floor.name}" at elevation ${floor.elevation} m.` };
      }
      case 'add_walls': {
        const p = await need(store, args);
        const floor = floorOf(p, args.floorId);
        const walls = (Array.isArray(args.walls) ? args.walls : []) as Record<string, unknown>[];
        const cmds: Command[] = [];
        const ids: string[] = [];
        const skipped: string[] = [];
        walls.forEach((w, i) => {
          const a = vec(w.a);
          const b = vec(w.b);
          if (!a || !b) return void skipped.push(`wall ${i + 1}: a/b must be [x, y]`);
          const wall: Wall = { id: rnd('wall'), a, b, thickness: clamp(num(w.thickness, 0.15), 0.04, 0.6), height: clamp(num(w.height, floor.height), 1.2, 6), color: '#e8e6e1', materialId: null };
          if (wallLength(wall) < 0.05) return void skipped.push(`wall ${i + 1}: zero length`);
          cmds.push({ type: 'ADD_WALL', floorId: floor.id, wall });
          ids.push(wall.id);
        });
        if (!cmds.length) return err(`No walls added. ${skipped.join('; ')}`);
        await store.put(run(p, { type: 'BATCH', label: 'Add walls', commands: cmds }));
        return { text: `Added ${ids.length} wall(s) on ${floor.name}: ${ids.join(', ')}${skipped.length ? `\nSkipped: ${skipped.join('; ')}` : ''}` };
      }
      case 'add_rectangular_room': {
        const p = await need(store, args);
        const floor = floorOf(p, args.floorId);
        const x = num(args.x, 0);
        const y = num(args.y, 0);
        const w = num(args.width, 4);
        const d = num(args.depth, 4);
        if (w < 0.5 || d < 0.5) return err('width and depth must be at least 0.5 m');
        const corners: Vec2[] = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }].map((c) => ({ x: r3(c.x), y: r3(c.y) }));
        const cmds: Command[] = [];
        const ids: string[] = [];
        for (let i = 0; i < 4; i++) {
          const a = corners[i];
          const b = corners[(i + 1) % 4];
          if (floor.walls.some((ex) => sameSegment(ex, a, b))) continue;
          const wall: Wall = { id: rnd('wall'), a, b, thickness: 0.15, height: floor.height, color: '#e8e6e1', materialId: null };
          cmds.push({ type: 'ADD_WALL', floorId: floor.id, wall });
          ids.push(wall.id);
        }
        const kind = str(args.kind, 'living').toLowerCase();
        const room: Room = { id: rnd('room'), name: str(args.name, 'Room'), points: corners, color: ROOM_COLORS[kind] ?? ROOM_COLORS.living, materialId: kind === 'bath' ? 'tile-white' : kind === 'kitchen' ? 'stone-marble-white' : 'wood-oak' };
        cmds.push({ type: 'ADD_ROOM', floorId: floor.id, room });
        await store.put(run(p, { type: 'BATCH', label: 'Add room', commands: cmds }));
        return { text: `Added room ${room.id} "${room.name}" (${(w * d).toFixed(1)} m²) with ${ids.length} new wall(s): ${ids.join(', ') || 'none (all shared)'}.` };
      }
      case 'add_room': {
        const p = await need(store, args);
        const floor = floorOf(p, args.floorId);
        const pts = (Array.isArray(args.points) ? args.points : []).map(vec).filter((v): v is Vec2 => !!v);
        if (pts.length < 3) return err('points needs at least 3 [x, y] pairs');
        const kind = str(args.kind, 'living').toLowerCase();
        const room: Room = { id: rnd('room'), name: str(args.name, 'Room'), points: pts, color: ROOM_COLORS[kind] ?? ROOM_COLORS.living, materialId: 'wood-oak' };
        await store.put(run(p, { type: 'ADD_ROOM', floorId: floor.id, room }));
        return { text: `Added room ${room.id} "${room.name}" (${Math.abs(polygonArea(pts)).toFixed(1)} m²).` };
      }
      case 'add_door':
      case 'add_window': {
        const p = await need(store, args);
        const floor = floorOf(p, args.floorId);
        const wall = pickWall(floor.walls, args);
        if (!wall) return err('No wall found: give wallId or near [x, y] (see get_project for wall ids).');
        const len = wallLength(wall);
        const isDoor = name === 'add_door';
        const width = clamp(num(args.width, isDoor ? 0.9 : 1.2), isDoor ? 0.6 : 0.4, Math.min(3, len));
        const at = args.near && !args.at ? closestPointOnSegment(vec(args.near)!, wall.a, wall.b).t * len : num(args.at, len / 2);
        const offset = r3(clamp(at - width / 2, 0, len - width));
        if (isDoor) {
          const behavior = str(args.behavior) as DoorBehavior;
          const door = { id: rnd('door'), kind: 'door' as const, wallId: wall.id, offset, width: r3(width), height: 2.1, swing: 1 as const, ...(['manual', 'automatic', 'open', 'locked'].includes(behavior) ? { metadata: { doorBehavior: behavior } } : {}) };
          await store.put(run(p, { type: 'ADD_DOOR', floorId: floor.id, door }));
          return { text: `Added door ${door.id} on wall ${wall.id} at offset ${offset} (width ${door.width}).` };
        }
        const sill = clamp(num(args.sill, 0.9), 0.1, 1.8);
        const win = { id: rnd('win'), kind: 'window' as const, wallId: wall.id, offset, width: r3(width), height: clamp(num(args.height, 2.4), sill + 0.3, 3), sill };
        await store.put(run(p, { type: 'ADD_WINDOW', floorId: floor.id, window: win }));
        return { text: `Added window ${win.id} on wall ${wall.id} at offset ${offset} (width ${win.width}).` };
      }
      case 'place_furniture': {
        const p = await need(store, args);
        const floor = floorOf(p, args.floorId);
        const items = (Array.isArray(args.items) ? args.items : []) as Record<string, unknown>[];
        const cmds: Command[] = [];
        const placed: string[] = [];
        const skipped: string[] = [];
        for (const it of items) {
          const asset = resolveAsset(str(it.asset));
          if (!asset) {
            skipped.push(`"${it.asset}" is not in the catalog`);
            continue;
          }
          const color = typeof it.color === 'string' && /^#[0-9a-f]{6}$/i.test(it.color) ? it.color : asset.color;
          const obj: ProjectObject = {
            id: rnd('obj'),
            assetId: asset.id,
            name: asset.name,
            shape: asset.shape,
            x: r3(num(it.x, 0)),
            z: r3(num(it.z, 0)),
            rotation: r3((num(it.rotationDeg, 0) * Math.PI) / 180),
            scale: 1,
            width: asset.width,
            depth: asset.depth,
            height: asset.shape === 'stairs' ? p.floorHeight : asset.height,
            color,
            materialId: null,
            ...(asset.mounted ? { metadata: { mounted: true } } : {}),
          };
          cmds.push({ type: 'ADD_OBJECT', floorId: floor.id, object: obj });
          placed.push(`${obj.id} ${asset.name} at (${obj.x}, ${obj.z})`);
        }
        if (!cmds.length) return err(`Nothing placed. ${skipped.join('; ')}`);
        const next = run(p, { type: 'BATCH', label: 'Place furniture', commands: cmds });
        await store.put(next);
        const errs = analyseFloor(next.floors.find((f) => f.id === floor.id)!).filter((w) => w.level === 'error').map((w) => w.message);
        return { text: `Placed ${placed.length} item(s) on ${floor.name}:\n${placed.join('\n')}${skipped.length ? `\nSkipped: ${skipped.join('; ')}` : ''}${errs.length ? `\nCollision errors now on this floor:\n- ${errs.join('\n- ')}` : ''}` };
      }
      case 'update_object': {
        const p = await need(store, args);
        const id = str(args.objectId);
        const floor = p.floors.find((f) => f.objects.some((o) => o.id === id));
        if (!floor) return err(`No object ${id}.`);
        const patch: Partial<ProjectObject> = {};
        if (typeof args.x === 'number') patch.x = r3(args.x);
        if (typeof args.z === 'number') patch.z = r3(args.z);
        if (typeof args.rotationDeg === 'number') patch.rotation = r3((args.rotationDeg * Math.PI) / 180);
        if (typeof args.scale === 'number') patch.scale = clamp(args.scale, 0.2, 4);
        if (typeof args.color === 'string') {
          patch.color = args.color;
          patch.materialId = null;
        }
        if (typeof args.materialId === 'string') patch.materialId = args.materialId;
        if (typeof args.name === 'string') patch.name = args.name;
        await store.put(run(p, { type: 'UPDATE_OBJECT', floorId: floor.id, id, patch }));
        return { text: `Updated ${id}: ${JSON.stringify(patch)}` };
      }
      case 'remove_items': {
        const p = await need(store, args);
        const ids = (Array.isArray(args.ids) ? args.ids : []).map((v) => str(v)).filter(Boolean);
        const cmds: Command[] = [];
        const missing: string[] = [];
        for (const id of ids) {
          let found = false;
          for (const f of p.floors) {
            if (f.walls.some((w) => w.id === id)) cmds.push({ type: 'DELETE_WALL', floorId: f.id, id });
            else if (f.doors.some((d) => d.id === id)) cmds.push({ type: 'DELETE_DOOR', floorId: f.id, id });
            else if (f.windows.some((w) => w.id === id)) cmds.push({ type: 'DELETE_WINDOW', floorId: f.id, id });
            else if (f.rooms.some((r) => r.id === id)) cmds.push({ type: 'DELETE_ROOM', floorId: f.id, id });
            else if (f.objects.some((o) => o.id === id)) cmds.push({ type: 'DELETE_OBJECT', floorId: f.id, id });
            else continue;
            found = true;
            break;
          }
          if (!found) missing.push(id);
        }
        if (!cmds.length) return err(`Nothing matched: ${missing.join(', ')}`);
        await store.put(run(p, { type: 'BATCH', label: 'Remove items', commands: cmds }));
        return { text: `Removed ${cmds.length} item(s).${missing.length ? ` Not found: ${missing.join(', ')}` : ''}` };
      }
      case 'set_walkthrough_start': {
        const p = await need(store, args);
        const floor = floorOf(p, args.floorId);
        const wt = p.walkthrough ?? { spawns: [], startSpawnId: null };
        const id = rnd('spawn');
        const spawn = { id, name: str(args.name, `Start ${wt.spawns.length + 1}`), floorId: floor.id, x: r3(num(args.x, 0)), z: r3(num(args.z, 0)), yaw: r3((num(args.yawDeg, 0) * Math.PI) / 180) };
        await store.put(run(p, { type: 'UPDATE_PROJECT', patch: { walkthrough: { spawns: [...wt.spawns, spawn], startSpawnId: id } } }));
        return { text: `Walkthrough now starts at (${spawn.x}, ${spawn.z}) on ${floor.name}.` };
      }
      case 'validate_project': {
        const p = await need(store, args);
        const out: string[] = [];
        for (const f of p.floors) {
          const ws = analyseFloor(f);
          out.push(`${f.name}: ${ws.filter((w) => w.level === 'error').length} error(s), ${ws.filter((w) => w.level === 'warning').length} warning(s)`);
          for (const w of ws) out.push(`  [${w.level}] ${w.message}${w.objectId ? ` (${w.objectId})` : ''}`);
        }
        return { text: out.join('\n') };
      }
      case 'export_project_json': {
        const p = await need(store, args);
        return { text: JSON.stringify(p) };
      }
      case 'open_in_studio': {
        const p = await need(store, args);
        return { text: `${store.studioUrl(p.id)}\nOpen it in the browser (sign in first). Press Walk in the editor to walk through it.` };
      }
      default:
        return err(`Unknown tool "${name}".`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// --- helpers ---------------------------------------------------------------------

const SPEC_SHAPE = `{
  "name": "Compact 2 BHK",
  "floorHeight": 3,
  "floors": [{
    "name": "Ground Floor",
    "walls": [{"id":"w1","a":[0,0],"b":[10,0],"thickness":0.2,"height":3}, ...],
    "rooms": [{"name":"Living Room","kind":"living","points":[[0,0],[6,0],[6,5],[0,5]]}, ...],
    "doors": [{"wall":"w3","at":5,"width":1.0,"behavior":"manual"}, ...],
    "windows": [{"wall":"w1","at":3,"width":1.6,"sill":0.9,"height":2.4}, ...],
    "objects": [{"asset":"living-sofa-3-seat","x":3,"z":3.9,"rotationDeg":180}, ...]
  }],
  "start": {"floor":0,"x":5,"z":4.5,"yawDeg":0}
}`;

function err(text: string): ToolResult {
  return { text, isError: true };
}

function saveNote(saved: { synced: boolean; note?: string }): string {
  return saved.synced ? '' : `\n(Note: ${saved.note ?? 'the storage service is not reachable; use export_project_json and import the file in the studio.'})`;
}

async function need(store: ProjectStore, args: Record<string, unknown>): Promise<Project> {
  const id = str(args.projectId);
  const p = id ? await store.get(id) : null;
  if (!p) throw new Error(`Project "${id}" not found. Use list_projects or create_project first.`);
  return p;
}

function floorOf(p: Project, floorId: unknown) {
  const id = str(floorId);
  const f = id ? p.floors.find((fl) => fl.id === id || fl.name.toLowerCase() === id.toLowerCase()) : p.floors[0];
  if (!f) throw new Error(`Floor "${id}" not found. Floors: ${p.floors.map((fl) => `${fl.name}=${fl.id}`).join(', ')}`);
  return f;
}

function run(p: Project, command: Command): Project {
  return applyCommand(p, command).project;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function sameSegment(w: Wall, a: Vec2, b: Vec2): boolean {
  const eq = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) < 1e-3 && Math.abs(p.y - q.y) < 1e-3;
  return (eq(w.a, a) && eq(w.b, b)) || (eq(w.a, b) && eq(w.b, a));
}

function pickWall(walls: Wall[], args: Record<string, unknown>): Wall | null {
  const id = str(args.wallId);
  if (id) return walls.find((w) => w.id === id) ?? null;
  const near = vec(args.near);
  if (!near) return null;
  let best: Wall | null = null;
  let bestD = Infinity;
  for (const w of walls) {
    const d = closestPointOnSegment(near, w.a, w.b).d;
    if (d < bestD) {
      best = w;
      bestD = d;
    }
  }
  return bestD < 1.5 ? best : null;
}
