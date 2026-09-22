import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, permissionsFor, ROLE_LABELS, type Role } from '@/lib/session';
import { sign, verify, sha256, safeEqual } from '@/lib/token';

const SECRET = 'test-secret-value-long-enough';

test('a client link can look but not touch', () => {
  const viewer = permissionsFor('viewer');
  assert.equal(viewer.edit, false);
  assert.equal(viewer.exportFiles, false);
  assert.equal(viewer.share, false);
  assert.equal(viewer.remove, false);
  assert.equal(viewer.ai, false);
  // …and gets the hardened view.
  assert.equal(viewer.protectedView, true);
});

test('an owner can do everything, a collaborator cannot share or delete', () => {
  const owner = permissionsFor('owner');
  assert.ok(owner.edit && owner.exportFiles && owner.share && owner.remove);
  assert.equal(owner.protectedView, false);

  const editor = permissionsFor('editor');
  assert.ok(editor.edit && editor.exportFiles);
  assert.equal(editor.share, false, 'a collaborator must not mint client links');
  assert.equal(editor.remove, false, 'a collaborator must not delete the project');
});

test('an absent role is treated as no permission at all', () => {
  assert.equal(can(null, 'edit'), false);
  assert.equal(can(undefined, 'exportFiles'), false);
  for (const role of Object.keys(ROLE_LABELS) as Role[]) {
    assert.equal(typeof can(role, 'edit'), 'boolean');
  }
});

test('a signed token round-trips', async () => {
  const token = await sign({ p: 'project-1', r: 'viewer', exp: 0 }, SECRET);
  const payload = await verify<{ p: string; r: string; exp: number }>(token, SECRET);
  assert.equal(payload?.p, 'project-1');
  assert.equal(payload?.r, 'viewer');
});

/**
 * The role travels inside the signature, which is the whole point: a client
 * cannot promote their own link by editing the part they can read.
 */
test('editing the payload invalidates the token', async () => {
  const token = await sign({ p: 'project-1', r: 'viewer', exp: 0 }, SECRET);
  const [body, mac] = token.split('.');
  const decoded = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  decoded.r = 'owner';
  const forgedBody = Buffer.from(JSON.stringify(decoded)).toString('base64url');
  assert.equal(await verify(`${forgedBody}.${mac}`, SECRET), null);
});

test('a token signed with another secret is rejected', async () => {
  const token = await sign({ p: 'project-1', exp: 0 }, SECRET);
  assert.equal(await verify(token, 'a-completely-different-secret'), null);
});

test('an expired link stops working', async () => {
  const expired = await sign({ p: 'project-1', exp: Date.now() - 1000 }, SECRET);
  assert.equal(await verify(expired, SECRET), null);

  const live = await sign({ p: 'project-1', exp: Date.now() + 60_000 }, SECRET);
  assert.ok(await verify(live, SECRET));

  // exp: 0 means "no expiry", not "expired in 1970".
  const forever = await sign({ p: 'project-1', exp: 0 }, SECRET);
  assert.ok(await verify(forever, SECRET));
});

test('malformed input never throws', async () => {
  for (const bad of ['', 'nonsense', 'a.b', 'only-one-part', null, undefined]) {
    assert.equal(await verify(bad as string, SECRET), null);
  }
});

test('passcodes are compared as hashes, in constant time', async () => {
  const hash = await sha256('1234');
  assert.notEqual(hash, '1234', 'the passcode itself must not be stored in the link');
  assert.equal(hash, await sha256('1234'));
  assert.notEqual(hash, await sha256('1235'));
  assert.equal(safeEqual(hash, await sha256('1234')), true);
  assert.equal(safeEqual(hash, await sha256('9999')), false);
  assert.equal(safeEqual('short', 'a-much-longer-value'), false);
});
