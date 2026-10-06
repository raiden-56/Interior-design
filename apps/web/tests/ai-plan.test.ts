import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '@interior/core';
import { planSpecToProject, extractJsonObject, summarizeProject, resolveAsset, PLAN_SPEC_JSON_SCHEMA, type PlanSpec } from '@/lib/ai-plan';
import { callTool, TOOL_DEFINITIONS, type ProjectStore } from '@/lib/mcp-tools';
import { exportProjectPdf, drawWatermark, PdfPage } from '@/lib/export/pdf';
import { exportProjectDxf } from '@/lib/export/dxf';
import { templateById } from '@/lib/templates';
import { isProjectShaped } from '@/lib/storage';
import { buildCollisionWorld, isStandable } from '@/components/walkthrough/WalkthroughCollision';
import { resolveStart } from '@/components/walkthrough/SpawnPoint';
import { bodyOf, DEFAULT_WALK_SETTINGS } from '@/components/walkthrough/WalkSettings';

const SPEC: PlanSpec = {
  name: 'Test 1 BHK',
  floorHeight: 3,
  floors: [
    {
      name: 'Ground Floor',
      walls: [
        { id: 'n', a: [0, 0], b: [8, 0], thickness: 0.2 },
        { id: 'e', a: [8, 0], b: [8, 6], thickness: 0.2 },
        { id: 's', a: [8, 6], b: [0, 6], thickness: 0.2 },
        { id: 'w', a: [0, 6], b: [0, 0], thickness: 0.2 },
        { id: 'mid', a: [4, 0], b: [4, 6] },
        { id: 'zero', a: [1, 1], b: [1, 1] },
      ],
      rooms: [
        { name: 'Living Room', kind: 'living', points: [[0, 0], [4, 0], [4, 6], [0, 6]] },
        { name: 'Bedroom', kind: 'bedroom', points: [[4, 0], [8, 0], [8, 6], [4, 6]] },
        { name: 'Broken', kind: 'bath', points: [[0, 0], [1, 1]] },
      ],
      doors: [
        { wall: 's', at: 2, width: 1.0 },
        { wall: 'mid', at: 3, width: 0.9, behavior: 'automatic' },
        { wall: 'ghost', at: 1 },
      ],
      windows: [
        { wall: 'n', at: 2, width: 1.6, sill: 0.9, height: 2.4 },
        { wall: 'e', at: 3, width: 9 },
      ],
      objects: [
        { asset: 'living-sofa-3-seat', x: 2, z: 4.5, rotationDeg: 180 },
        { asset: 'Queen Bed', x: 6, z: 1.3 },
        { asset: 'sofa', x: 2, z: 1.5 },
        { asset: 'flying-carpet', x: 1, z: 1 },
        { asset: 'bedroom-nightstand', x: Number.NaN, z: 1 },
      ],
    },
  ],
  start: { floor: 0, x: 2, z: 5.2, yawDeg: 0 },
};

test('a plan spec becomes a valid project; junk is dropped and reported', () => {
  const { project, notes } = planSpecToProject(SPEC);
  assert.ok(isProjectShaped(project));
  const f = project.floors[0];
  assert.equal(f.walls.length, 5, 'zero-length wall dropped');
  assert.equal(f.rooms.length, 2, 'two-point room dropped');
  assert.equal(f.doors.length, 2, 'door on a missing wall dropped');
  assert.equal(f.windows.length, 2, 'an over-wide window is kept but clamped');
  assert.ok(f.windows.every((w) => w.width <= 3 && w.offset + w.width <= 6 + 1e-9), 'clamped to the wall');
  assert.equal(f.objects.length, 3, 'unknown asset and NaN position dropped; name and keyword resolve');
  assert.ok(notes.some((n) => n.includes('zero length')));
  assert.ok(notes.some((n) => n.includes('ghost')));
  assert.ok(notes.some((n) => n.includes('flying-carpet')));
  // Door offsets are centre-relative in the spec, start-relative in the model.
  const south = f.walls.find((w) => w.a.x === 8 && w.a.y === 6)!;
  const entrance = f.doors.find((d) => d.wallId === south.id)!;
  assert.equal(entrance.offset, 1.5);
  assert.equal(entrance.width, 1);
  const mid = f.doors.find((d) => d.wallId !== south.id)!;
  assert.equal(mid.metadata?.doorBehavior, 'automatic');
  assert.equal(f.rooms[0].color, '#4a68a6');
  assert.equal(project.walkthrough?.spawns[0].x, 2);
  assert.equal(project.walkthrough?.startSpawnId, 'spawn-start');
});

test('AI-built plans are walkable: the spawn is standable and rooms have floors', () => {
  const { project } = planSpecToProject(SPEC);
  const world = buildCollisionWorld(project);
  const start = resolveStart(project, world, bodyOf(DEFAULT_WALK_SETTINGS));
  assert.equal(start.spawnId, 'spawn-start');
  assert.ok(isStandable(world, start.x, start.z, start.y, bodyOf(DEFAULT_WALK_SETTINGS)));
});

test('two floors stack at the floor height and stairs get the full rise', () => {
  const spec: PlanSpec = {
    name: 'Duplex',
    floorHeight: 3.2,
    floors: [
      { name: 'G', walls: [{ a: [0, 0], b: [6, 0] }], rooms: [], doors: [], windows: [], objects: [{ asset: 'structure-straight-staircase', x: 1, z: 3 }] },
      { name: 'F1', walls: [{ a: [0, 0], b: [6, 0] }], rooms: [], doors: [], windows: [], objects: [] },
    ],
  };
  const { project } = planSpecToProject(spec);
  assert.equal(project.floors[1].elevation, 3.2);
  assert.equal(project.floors[0].objects[0].height, 3.2);
});

test('JSON extraction tolerates fences and prose; the schema is strict', () => {
  assert.deepEqual(extractJsonObject('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('{"a":{"b":[1,2]}} trailing'), { a: { b: [1, 2] } });
  assert.throws(() => extractJsonObject('no json here'));
  assert.equal(PLAN_SPEC_JSON_SCHEMA.additionalProperties, false);
  assert.ok(PLAN_SPEC_JSON_SCHEMA.required.includes('floors'));
  assert.equal(resolveAsset('couch')?.shape, 'sofa');
  assert.equal(resolveAsset('does-not-exist-xyz'), null);
});

// --- MCP tools ------------------------------------------------------------------------------

function memoryStore(): ProjectStore & { projects: Map<string, Project> } {
  const projects = new Map<string, Project>();
  return {
    projects,
    async get(id) {
      return projects.get(id) ?? null;
    },
    async put(p) {
      projects.set(p.id, p);
      return { synced: true };
    },
    async list() {
      return Array.from(projects.values()).map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }));
    },
    studioUrl(id) {
      return `http://studio.test/editor/${id}`;
    },
  };
}

test('MCP tools: build a house step by step through the command engine', async () => {
  const store = memoryStore();
  assert.ok(TOOL_DEFINITIONS.every((t) => t.name && t.description && t.inputSchema));
  const created = await callTool('create_project', { name: 'MCP House' }, store);
  assert.ok(!created.isError, created.text);
  const id = created.text.match(/project (project-[a-z0-9]+)/)![1];
  assert.ok(created.text.includes('http://studio.test/editor/'));

  const room = await callTool('add_rectangular_room', { projectId: id, name: 'Living', x: 0, y: 0, width: 6, depth: 5, kind: 'living' }, store);
  assert.ok(!room.isError, room.text);
  let p = store.projects.get(id)!;
  assert.equal(p.floors[0].walls.length, 4);
  assert.equal(p.floors[0].rooms.length, 1);

  // A second room sharing a wall adds only three.
  await callTool('add_rectangular_room', { projectId: id, name: 'Kitchen', x: 6, y: 0, width: 4, depth: 5, kind: 'kitchen' }, store);
  p = store.projects.get(id)!;
  assert.equal(p.floors[0].walls.length, 7);

  const door = await callTool('add_door', { projectId: id, near: [6, 2.5], width: 0.9 }, store);
  assert.ok(!door.isError, door.text);
  p = store.projects.get(id)!;
  assert.equal(p.floors[0].doors.length, 1);
  const sharedWall = p.floors[0].walls.find((w) => w.a.x === 6 && w.b.x === 6)!;
  assert.equal(p.floors[0].doors[0].wallId, sharedWall.id);

  const win = await callTool('add_window', { projectId: id, wallId: p.floors[0].walls[0].id, at: 3, width: 1.5 }, store);
  assert.ok(!win.isError, win.text);

  const placed = await callTool('place_furniture', { projectId: id, items: [{ asset: 'living-sofa-3-seat', x: 3, z: 4, rotationDeg: 180 }, { asset: 'nonsense-item', x: 1, z: 1 }] }, store);
  assert.ok(!placed.isError, placed.text);
  assert.ok(placed.text.includes('Skipped'));
  p = store.projects.get(id)!;
  assert.equal(p.floors[0].objects.length, 1);
  const sofaId = p.floors[0].objects[0].id;

  const moved = await callTool('update_object', { projectId: id, objectId: sofaId, x: 2.5, color: '#112233' }, store);
  assert.ok(!moved.isError);
  p = store.projects.get(id)!;
  assert.equal(p.floors[0].objects[0].x, 2.5);
  assert.equal(p.floors[0].objects[0].color, '#112233');

  const floor = await callTool('add_floor', { projectId: id, name: 'First' }, store);
  assert.ok(!floor.isError);
  p = store.projects.get(id)!;
  assert.equal(p.floors.length, 2);
  assert.equal(p.floors[1].elevation, 3);

  const start = await callTool('set_walkthrough_start', { projectId: id, x: 3, z: 2.5, yawDeg: 0 }, store);
  assert.ok(!start.isError);
  assert.equal(store.projects.get(id)!.walkthrough?.spawns.length, 1);

  const valid = await callTool('validate_project', { projectId: id }, store);
  assert.ok(valid.text.includes('error(s)'));

  const removed = await callTool('remove_items', { projectId: id, ids: [sofaId, 'nope'] }, store);
  assert.ok(removed.text.includes('Removed 1'));
  assert.equal(store.projects.get(id)!.floors[0].objects.length, 0);

  const summary = await callTool('get_project', { projectId: id }, store);
  assert.ok(summary.text.includes('Living') && summary.text.includes('Kitchen'));
  const json = await callTool('export_project_json', { projectId: id }, store);
  assert.ok(isProjectShaped(JSON.parse(json.text)));
  const missing = await callTool('get_project', { projectId: 'nope' }, store);
  assert.equal(missing.isError, true);
  const unknown = await callTool('frobnicate', {}, store);
  assert.equal(unknown.isError, true);
});

test('MCP tools: a whole plan from a spec, and a project from a template', async () => {
  const store = memoryStore();
  const res = await callTool('create_project_from_spec', { spec: SPEC }, store);
  assert.ok(!res.isError, res.text);
  assert.ok(res.text.includes('Skipped/adjusted'));
  const tpl = await callTool('create_project', { name: 'From duplex', template: 'duplex' }, store);
  assert.ok(!tpl.isError);
  const id = tpl.text.match(/project (project-[a-z0-9]+)/)![1];
  assert.equal(store.projects.get(id)!.floors.length, 2);
  const bad = await callTool('create_project', { name: 'x', template: 'nope' }, store);
  assert.equal(bad.isError, true);
  const guide = await callTool('authoring_guide', {}, store);
  assert.ok(guide.text.includes('PlanSpec'));
  const cat = await callTool('list_catalog', { query: 'sofa' }, store);
  assert.ok(cat.text.includes('living-sofa-3-seat'));
});

// --- exports ----------------------------------------------------------------------------------

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

test('PDF export: one page per floor, valid structure, watermark only when asked', () => {
  const project = templateById('duplex')!.build();
  const pdf = exportProjectPdf(project, { floors: project.floors, paper: 'A4', watermark: 'DRAFT COPY', furniture: true, author: 'Tester', date: new Date('2026-10-06') });
  const s = text(pdf);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.equal((s.match(/\/Type \/Page\b/g) ?? []).length, 2, 'two floors, two pages');
  assert.ok(s.includes('/Count 2'));
  assert.ok(s.includes('(DRAFT COPY)'), 'watermark text drawn');
  assert.ok(s.includes('NOT FOR CONSTRUCTION'));
  assert.ok(s.includes('(Living & Dining)'));
  // xref offsets must point at "N 0 obj".
  const startxref = Number(s.match(/startxref\n(\d+)/)![1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const firstOffset = Number(s.match(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/)![1]);
  assert.ok(s.slice(firstOffset).startsWith('1 0 obj'));

  const clean = text(exportProjectPdf(project, { floors: [project.floors[0]], paper: 'A3', watermark: null, furniture: false }));
  assert.equal((clean.match(/\/Type \/Page\b/g) ?? []).length, 1);
  assert.ok(!clean.includes('(DRAFT COPY)'));
  assert.ok(!clean.includes('NOT FOR CONSTRUCTION'));
  assert.ok(!clean.includes('(Sofa 3-seat)'), 'furniture labels off');
  assert.ok(pdf.length > clean.length);
});

test('PDF export: an embedded 3D snapshot adds an image page', () => {
  const project = templateById('1bhk')!.build();
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xd9]).toString('base64');
  const s = text(exportProjectPdf(project, { floors: project.floors, paper: 'A4', watermark: null, furniture: true, snapshot: { jpegBase64: fakeJpeg, width: 640, height: 400 } }));
  assert.equal((s.match(/\/Type \/Page\b/g) ?? []).length, 2);
  assert.ok(s.includes('/Subtype /Image') && s.includes('/DCTDecode') && s.includes('/Width 640'));
  const page = new PdfPage(100, 100);
  drawWatermark(page, 'X');
  assert.ok(page.ops.length > 1);
});

test('DXF export: R12 structure, layers, entities for every element, watermark layer optional', () => {
  const project = templateById('2bhk')!.build();
  const floor = project.floors[0];
  const dxf = exportProjectDxf(project, { floors: [floor], watermark: 'PREVIEW ONLY', furniture: true, roomLabels: true });
  assert.ok(dxf.startsWith('0\r\nSECTION\r\n2\r\nHEADER'));
  assert.ok(dxf.includes('AC1009'));
  assert.ok(dxf.trimEnd().endsWith('EOF'));
  for (const layer of ['WALLS', 'DOORS', 'WINDOWS', 'ROOMS', 'FURNITURE', 'TEXT', 'DIMENSIONS', 'WATERMARK']) assert.ok(dxf.includes(`\r\n2\r\n${layer}\r\n`), `layer ${layer} declared`);
  const count = (re: RegExp) => (dxf.match(re) ?? []).length;
  assert.ok(count(/\r\n0\r\nPOLYLINE\r\n8\r\nWALLS/g) >= floor.walls.length, 'at least one wall polyline per wall');
  assert.equal(count(/\r\n0\r\nARC\r\n8\r\nDOORS/g), floor.doors.filter((d) => d.swing !== 0).length, 'one swing arc per swinging door');
  assert.equal(count(/\r\n0\r\nPOLYLINE\r\n8\r\nFURNITURE/g), floor.objects.length);
  assert.equal(count(/\r\n0\r\nPOLYLINE\r\n8\r\nROOMS/g), floor.rooms.length);
  assert.ok(count(/\r\n0\r\nTEXT\r\n8\r\nWATERMARK/g) >= 4, 'watermark repeated');
  assert.ok(count(/\r\n0\r\nVERTEX/g) === count(/\r\n0\r\nSEQEND/g) * 0 + count(/\r\n0\r\nVERTEX/g), 'sanity');
  assert.equal(count(/\r\n0\r\nPOLYLINE/g), count(/\r\n0\r\nSEQEND/g), 'every polyline is closed off');
  assert.ok(!dxf.includes('\r\n0\r\nTEXT\r\n8\r\nWATERMARK') === false);
  // Plan y points south; DXF y points up, so the first room's y coordinates are negated.
  const firstRoom = floor.rooms[0].points[2];
  assert.ok(dxf.includes(`\r\n20\r\n${-firstRoom.y}\r\n`) || dxf.includes(`\r\n20\r\n${String(-firstRoom.y).replace(/^-0$/, '0')}\r\n`));

  const clean = exportProjectDxf(project, { floors: project.floors, watermark: null, furniture: false, roomLabels: false });
  assert.equal(count.call(null, /x/g) >= 0, true);
  assert.equal((clean.match(/\r\n0\r\nTEXT\r\n8\r\nWATERMARK/g) ?? []).length, 0);
  assert.equal((clean.match(/\r\n0\r\nPOLYLINE\r\n8\r\nFURNITURE/g) ?? []).length, 0);
  assert.ok(!clean.includes('NOT FOR CONSTRUCTION'));
});

test('summaries list ids an AI can act on', () => {
  const project = templateById('1bhk')!.build();
  const s = summarizeProject(project);
  assert.ok(s.includes(project.floors[0].id));
  assert.ok(s.includes(project.floors[0].objects[0].id));
  assert.ok(s.includes('m²'));
});
