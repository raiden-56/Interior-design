import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createProject, createWall, pushHistory, initialHistory, undoCommand } from '@interior/core';
import type { Command, Project } from '@interior/core';

function fresh(): Project {
  const p = createProject('t');
  p.floors[0].walls.push(createWall({ x: 0, y: 0 }, { x: 4, y: 0 }));
  p.floors[0].objects.push({
    id: 'obj-1',
    assetId: 'living-sofa-3-seat',
    name: 'Sofa',
    shape: 'sofa',
    x: 1,
    z: 1,
    rotation: 0,
    scale: 1,
    width: 2,
    depth: 0.9,
    height: 0.8,
    color: '#ff0000',
    materialId: null,
  });
  return p;
}

test('applyCommand never mutates the input project', () => {
  const p = fresh();
  const before = JSON.stringify({ ...p, updatedAt: 0 });
  applyCommand(p, { type: 'UPDATE_OBJECT', id: 'obj-1', patch: { x: 9 } });
  assert.equal(JSON.stringify({ ...p, updatedAt: 0 }), before);
});

test('undoing a wall endpoint move restores the original endpoint', () => {
  // The 2D editor used to mutate the wall in place while dragging, so the
  // inverse captured the *moved* endpoint and undo was a no-op.
  const p = fresh();
  const wall = p.floors[0].walls[0];
  const moved = applyCommand(p, { type: 'UPDATE_WALL', id: wall.id, patch: { a: { x: 1, y: 1 }, b: { ...wall.b } } });
  assert.deepEqual(moved.project.floors[0].walls[0].a, { x: 1, y: 1 });

  const undone = applyCommand(moved.project, moved.inverse);
  assert.deepEqual(undone.project.floors[0].walls[0].a, { x: 0, y: 0 });
});

test('a BATCH undoes in reverse order and restores everything', () => {
  const p = fresh();
  const batch: Command = {
    type: 'BATCH',
    label: 't',
    commands: [
      { type: 'UPDATE_OBJECT', id: 'obj-1', patch: { color: '#00ff00', materialId: 'wood-oak' } },
      { type: 'UPDATE_OBJECT', id: 'obj-1', patch: { x: 5 } },
      { type: 'DELETE_WALL', id: p.floors[0].walls[0].id },
    ],
  };
  const applied = applyCommand(p, batch);
  assert.equal(applied.project.floors[0].walls.length, 0);
  assert.equal(applied.project.floors[0].objects[0].x, 5);

  const undone = applyCommand(applied.project, applied.inverse);
  assert.equal(undone.project.floors[0].walls.length, 1);
  const o = undone.project.floors[0].objects[0];
  assert.equal(o.x, 1);
  assert.equal(o.color, '#ff0000');
  assert.equal(o.materialId, null);
});

test('deleting a wall also removes its doors and windows, and undo brings the wall back', () => {
  const p = fresh();
  const wall = p.floors[0].walls[0];
  p.floors[0].doors.push({ id: 'door-1', kind: 'door', wallId: wall.id, offset: 1, width: 0.9, height: 2.1, swing: 1 });
  const res = applyCommand(p, { type: 'DELETE_WALL', id: wall.id });
  assert.equal(res.project.floors[0].doors.length, 0, 'orphaned door should be removed');
  const back = applyCommand(res.project, res.inverse);
  assert.equal(back.project.floors[0].walls.length, 1);
});

test('history: undo command is the inverse of the latest entry', () => {
  const p = fresh();
  const res = applyCommand(p, { type: 'UPDATE_OBJECT', id: 'obj-1', patch: { rotation: 1 } });
  const h = pushHistory(initialHistory(), { id: 1, label: 'rot', applied: { type: 'UPDATE_OBJECT', id: 'obj-1', patch: { rotation: 1 } }, inverse: res.inverse });
  const undo = undoCommand(h);
  assert.ok(undo && undo.type === 'UPDATE_OBJECT');
  assert.equal((undo as { patch: { rotation: number } }).patch.rotation, 0);
});
