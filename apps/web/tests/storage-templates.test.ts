import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseFloor, wallLength } from '@interior/core';
import { isProjectShaped, parseProjectFile, slugify } from '@/lib/storage';
import { TEMPLATES, templateById, templateStats } from '@/lib/templates';
import { assetById, FURNITURE_LIBRARY, keywordToAssets } from '@/lib/furniture';

test('every template builds a valid project with resolvable assets', () => {
  for (const t of TEMPLATES) {
    const p = t.build();
    assert.ok(isProjectShaped(p), `${t.id} is project-shaped`);
    assert.ok(p.floors[0].walls.every((w) => wallLength(w) > 0.05), `${t.id} has no zero-length walls`);
    for (const o of p.floors[0].objects) {
      assert.ok(assetById(o.assetId), `${t.id}: unknown asset ${o.assetId}`);
    }
    for (const d of [...p.floors[0].doors, ...p.floors[0].windows]) {
      const wall = p.floors[0].walls.find((w) => w.id === d.wallId);
      assert.ok(wall, `${t.id}: opening on missing wall`);
      assert.ok(d.offset + d.width <= wallLength(wall!) + 1e-6, `${t.id}: opening runs past its wall`);
    }
    // Templates should not ship with objects poking through walls.
    const errors = analyseFloor(p.floors[0]).filter((w) => w.level === 'error');
    assert.deepEqual(errors, [], `${t.id}: ${errors.map((e) => e.message).join('; ')}`);
  }
});

test('template ids are unique and include a blank canvas', () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('blank'));
});

/**
 * Regression: every `place()` call used to resolve to nothing, so the
 * templates shipped as empty shells — the test above still passed because it
 * only checked the objects that made it through.
 */
test('furnished templates actually arrive furnished', () => {
  for (const t of TEMPLATES) {
    const floor = t.build().floors[0];
    if (t.id === 'blank') {
      assert.equal(floor.objects.length, 0);
      continue;
    }
    assert.ok(floor.objects.length >= 15, `${t.id} placed only ${floor.objects.length} objects`);
    assert.ok(floor.doors.length >= 1, `${t.id} has no doors`);
    assert.ok(floor.windows.length >= 3, `${t.id} has too few windows`);
    assert.ok(floor.rooms.length >= 1, `${t.id} has no rooms`);
  }
});

test('the home plans cover 1, 2 and 3 bedroom layouts with kitchen and bathroom fittings', () => {
  const needed: Record<string, { bedrooms: number; fittings: string[] }> = {
    '1bhk': { bedrooms: 1, fittings: ['kitchen-refrigerator', 'kitchen-washing-machine', 'bathroom-toilet'] },
    '2bhk': { bedrooms: 2, fittings: ['kitchen-refrigerator', 'kitchen-washing-machine', 'kitchen-oven-range'] },
    '3bhk': { bedrooms: 3, fittings: ['kitchen-refrigerator', 'kitchen-washing-machine', 'kitchen-dishwasher'] },
  };
  for (const [id, want] of Object.entries(needed)) {
    const template = templateById(id);
    assert.ok(template, `missing template ${id}`);
    assert.equal(template!.bedrooms, want.bedrooms);
    const floor = template!.build().floors[0];
    const ids = new Set(floor.objects.map((o) => o.assetId));
    for (const fitting of want.fittings) assert.ok(ids.has(fitting), `${id} is missing ${fitting}`);
    const beds = floor.objects.filter((o) => o.shape === 'bed' || o.shape === 'bunk-bed');
    assert.ok(beds.length >= want.bedrooms, `${id} has ${beds.length} beds for ${want.bedrooms} bedrooms`);
  }
});

test('templateStats measures the plan it will create', () => {
  const stats = templateStats(templateById('2bhk')!.build());
  assert.equal(stats.footprint, '10.0 × 9.0 m');
  assert.ok(stats.carpetArea > 80 && stats.carpetArea < 95, `carpet area ${stats.carpetArea}`);
  assert.ok(stats.rooms.length >= 6);
  // Sorted largest first, so the gallery reads top-down.
  assert.deepEqual([...stats.rooms].sort((a, b) => b.area - a.area), stats.rooms);
});

test('catalog ids are unique and every AI keyword resolves to one', () => {
  const ids = FURNITURE_LIBRARY.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate asset ids');
  for (const [keyword, mapped] of Object.entries(keywordToAssets)) {
    for (const id of mapped) assert.ok(assetById(id), `keyword "${keyword}" points at missing asset ${id}`);
  }
  // The pieces people asked for by name.
  for (const id of ['kitchen-washing-machine', 'kitchen-dishwasher', 'kitchen-chimney-hood', 'living-wall-tv-55-inch', 'living-split-ac', 'decoration-pooja-unit']) {
    assert.ok(assetById(id), `catalog is missing ${id}`);
  }
});

test('mounted pieces carry the flag that exempts them from floor clearance', () => {
  const floor = templateById('2bhk')!.build().floors[0];
  const acs = floor.objects.filter((o) => o.shape === 'ac-split');
  assert.ok(acs.length > 0);
  for (const ac of acs) assert.equal(ac.metadata?.mounted, true);
});

test('parseProjectFile accepts an export and assigns a fresh id', () => {
  const original = TEMPLATES[1].build();
  const imported = parseProjectFile(JSON.stringify(original));
  assert.notEqual(imported.id, original.id);
  assert.equal(imported.name, original.name);
  assert.equal(imported.floors[0].objects.length, original.floors[0].objects.length);
});

test('parseProjectFile rejects junk with a readable message', () => {
  assert.throws(() => parseProjectFile('not json'), /valid JSON/);
  assert.throws(() => parseProjectFile('{"hello":"world"}'), /not an Interior Studio project/);
});

test('slugify produces safe filenames', () => {
  assert.equal(slugify('My Flat / Draft 2!'), 'my-flat-draft-2');
  assert.equal(slugify('   '), 'project');
});
