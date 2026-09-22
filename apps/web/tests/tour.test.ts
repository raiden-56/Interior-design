import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The tour points at elements by `data-tour` attribute, which is exactly the
 * kind of link that rots: someone renames an attribute, the tour silently
 * skips a step, and nobody notices until a new user is staring at a dimmed
 * screen. These tests read both sides and compare them.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const tourSource = fs.readFileSync(path.join(SRC, 'lib', 'tour.ts'), 'utf8');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Every `data-tour="…"` the components actually render. */
function anchorsInComponents(): Set<string> {
  const found = new Set<string>();
  for (const file of walk(SRC)) {
    if (file.endsWith(path.join('lib', 'tour.ts'))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/data-tour="([^"]+)"/g)) found.add(m[1]);
    // Template form: data-tour={`tool-${t.id}`}
    for (const m of text.matchAll(/data-tour=\{`([^`$]*)\$\{[^}]+\}`\}/g)) found.add(m[1] + '*');
  }
  return found;
}

/** Every `[data-tour="…"]` the tour asks for. */
function targetsInTour(): string[] {
  return [...tourSource.matchAll(/\[data-tour="([^"]+)"\]/g)].map((m) => m[1]);
}

test('every element the tour points at exists in a component', () => {
  const anchors = anchorsInComponents();
  const prefixes = [...anchors].filter((a) => a.endsWith('*')).map((a) => a.slice(0, -1));
  const missing = targetsInTour().filter((target) => {
    if (anchors.has(target)) return false;
    return !prefixes.some((p) => target.startsWith(p));
  });
  assert.deepEqual(missing, [], `tour targets with no matching data-tour attribute: ${missing.join(', ')}`);
});

test('the tour covers every tool in the toolbar', () => {
  const targets = targetsInTour();
  for (const tool of ['select', 'pan', 'wall', 'door', 'window', 'room', 'measure']) {
    assert.ok(targets.includes(`tool-${tool}`), `the tour never explains the ${tool} tool`);
  }
});

test('the tour covers the panels, the views and the file actions', () => {
  const targets = targetsInTour();
  for (const area of [
    'canvas',
    'left-panel',
    'right-panel',
    'tab-furniture',
    'tab-structure',
    'furniture-grid',
    'view-toggle',
    'camera-presets',
    'transform-modes',
    'floors',
    'units',
    'history',
    'save',
    'export',
    'share',
    'help',
  ]) {
    assert.ok(targets.includes(area), `the tour never explains "${area}"`);
  }
});

test('the tour explains the jobs people come to do', () => {
  // Coverage by task rather than by selector: the materials stop highlights
  // the whole panel, so requiring a specific anchor would pin the wrong thing.
  for (const phrase of ['Painting a wall', 'Adding an object', 'Sharing with a client', 'Import and export', 'Rotating and moving']) {
    assert.ok(tourSource.includes(`title: '${phrase}`), `no stop covers "${phrase}"`);
  }
});

test('every stop has a title and an explanation, and none repeat', () => {
  const titles = [...tourSource.matchAll(/^\s{4}title: '(.+?)',$/gm)].map((m) => m[1]);
  const texts = [...tourSource.matchAll(/^\s{4}text: '(.+?)',$/gms)].map((m) => m[1]);
  assert.ok(titles.length >= 25, `expected the full tour, found ${titles.length} titles`);
  assert.equal(new Set(titles).size, titles.length, 'two stops share a title');
  assert.ok(texts.every((t) => t.length > 40), 'a stop has no real explanation');
});

test('a read-only session gets its own short tour', () => {
  assert.match(tourSource, /VIEWER_STOPS/);
  assert.match(tourSource, /sessionCan\('edit'\) \? EDITOR_STOPS : VIEWER_STOPS/);
});

/**
 * Regression: switching the active tool inside a step re-renders that button,
 * and React's className reconciliation strips the class driver.js uses to keep
 * the highlighted element raised and clickable.
 */
test('no stop changes the tool it is highlighting', () => {
  const toolStops = tourSource.split('{').filter((chunk) => /data-tour="tool-/.test(chunk));
  for (const chunk of toolStops) {
    assert.ok(!/setTool\(/.test(chunk), 'a tool stop must not call setTool — it wipes its own highlight');
  }
});
