const assert = require('node:assert/strict');
const test = require('node:test');
const { parseHTML } = require('linkedom');
const M = require('../marketplace-core.js');
const C = require('../marketplace-content.js');
const { createMockApi } = require('../marketplace-mock.js');

/** Encode a u32 length, including multi-byte lengths used by actual metadata. */
function leb(value) {
  const bytes = [];
  do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return bytes;
}
/** Create a real custom-section framing around caller-supplied payloads. */
function component(sections) {
  const bytes = [0, 97, 115, 109, 13, 0, 1, 0];
  for (const [name, value] of sections) {
    const encoded = Buffer.from(name);
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const body = [...leb(encoded.length), ...encoded, ...data];
    bytes.push(0, ...leb(body.length), ...body);
  }
  return Uint8Array.from(bytes);
}

test('rejects malformed headers, section IDs, section-local lengths and overflowing LEB values', () => {
  const header = [0, 97, 115, 109, 13, 0, 1, 0];
  assert.throws(() => M.readComponent(Uint8Array.from([0, 97, 115, 109, 13, 255, 1, 255])), /header/);
  for (const tail of [[255, 0], [0, 1, 10], [0, 1, 128, 1, 0], [0, 255, 255, 255, 255, 16]]) {
    assert.throws(() => M.readComponent(Uint8Array.from([...header, ...tail])), /section|Truncated|Malformed/);
  }
  assert.throws(() => M.readComponent(component([['version', Buffer.from([255])]])), /encoded data|encoding/i);
  assert.throws(() => M.readComponent(new Uint8Array(16 * 1024 * 1024 + 1)), /16 MiB/);
  const long = 'a'.repeat(300);
  assert.equal(M.readComponent(component([['description', long]])).description, long);
});

test('rejects duplicate metadata, escaped duplicate grants, non-object grants and truncated names', () => {
  assert.throws(() => M.readComponent(component([['cinnabar:grants', '{}'], ['cinnabar:grants', '{}']])), /Duplicate metadata/);
  assert.throws(() => M.readComponent(component([['version', '1.0.0'], ['version', '2.0.0']])), /Duplicate metadata/);
  for (const grants of ['null', '[]', '{"hud":true,"hud":false}', '{"hud":true,"h\\u0075d":false}']) {
    assert.throws(() => M.readComponent(component([['cinnabar:grants', grants]])), /object|Duplicate/);
  }
  assert.throws(() => M.readComponent(component([['component-name', Buffer.from([0, 2, 8, 65])]])), /component name/);
});

test('tracks command value expansion, replacements, removal and set-equivalent requests', () => {
  const replaced = M.grantDiff({ commands: ['say'] }, { commands: ['op'] });
  assert.deepEqual(replaced.commands, { added: ['op'], removed: ['say'] });
  assert.deepEqual(replaced.changed, ['commands']); assert.equal(replaced.expanded, true);
  assert.equal(M.grantDiff({ commands: ['say', 'op'] }, { commands: ['say'] }).expanded, false);
  assert.deepEqual(M.grantDiff({ commands: ['op', 'say'] }, { commands: ['say', 'op', 'say'] }).changed, []);
  assert.equal(M.grantDiff({}, { commands: ['say'] }).expanded, true);
  assert.throws(() => M.requestedCapabilities({ commands: new Array(2) }), /names/);
  assert.equal(M.can({ xuid: 'a', role: 'owner' }, 'set-role', { target: { xuid: 'b', role: 'player' }, role: '__proto__' }).ok, false);
});

test('renders creator Markdown and links as inert DOM and rejects executable image URLs', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const markup = C.markdown(document, '## Good heading\n- **Useful**\n<script>alert(1)</script>\n[x](javascript:alert)\n[docs](https://example.com/docs)');
  assert.equal(markup.querySelector('script'), null);
  assert.equal(markup.querySelector('h2').textContent, 'Good heading');
  assert.equal(markup.querySelector('strong').textContent, 'Useful');
  assert.equal(markup.querySelectorAll('a').length, 1);
  assert.equal(markup.querySelector('a').getAttribute('rel'), 'noopener noreferrer');
  assert.match(markup.textContent, /<script>/);
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://user:secret@example.com/image.png']) assert.equal(C.imageUrl(value), null);
});

test('full validator rejects invalid component types and nested guest bytecode without executing starts', async () => {
  const { validateComponent } = await import('../marketplace-validator-engine.mjs');
  const { parse } = await import('@bytecodealliance/jco-transpile/wasm-tools');
  assert.deepEqual(await validateComponent(await parse('(component)')), { imports: [], exports: [] });
  const invalid = await parse('(component (core module (func (result i32) f32.const 1)))');
  await assert.rejects(validateComponent(invalid), /type mismatch|invalid/i);
  await assert.rejects(validateComponent(Uint8Array.from([0, 97, 115, 109, 13, 255, 1, 255])), /version|header|magic|invalid/i);
  // An instance whose start traps validates successfully: a check must never execute it.
  const trapping = await parse('(component (core module (func $start unreachable) (start $start)) (core instance (instantiate 0)))');
  assert.deepEqual(await validateComponent(trapping), { imports: [], exports: [] });
});

test('pending listing edits stay private, approved metadata follows its version, and unavailable library entries remain removable', async () => {
  const memory = new Map();
  const api = createMockApi({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) }, () => 1234567890000);
  await api.request('POST', '/auth/preview', { xuid: '2535400000000102' });
  const before = (await api.request('GET', '/mods/time-changer')).body;
  const submitted = await api.request('POST', '/submissions', { slug: 'time-changer', name: 'Changed private title', summary: 'A different private summary.',
    description: 'This is a private draft.', notes: 'Added clearer controls.', version: '1.3.0', grants: { environment: true }, sha256: 'a'.repeat(64), bytes: 100 });
  assert.equal(submitted.status, 200);
  assert.equal((await api.request('GET', '/mods/time-changer')).body.name, before.name);
  await api.request('POST', '/auth/preview', { xuid: '2535400000000201' });
  const view = (await api.request('GET', '/staff/versions/' + submitted.body.id)).body;
  assert.equal(view.name, 'Changed private title');
  assert.deepEqual(view.previous.grants, { environment: true });
  await api.request('POST', '/staff/versions/' + submitted.body.id + '/decision', { decision: 'approve' });
  assert.equal((await api.request('GET', '/mods/time-changer')).body.name, 'Changed private title');
  assert.equal((await api.request('GET', '/mods/time-changer')).body.history[0].notes, 'Added clearer controls.');
  await api.request('POST', '/auth/preview', { xuid: '2535400000000101' });
  await api.request('POST', '/mods/time-changer/send');
  await api.request('POST', '/auth/preview', { xuid: '2535400000000301' });
  await api.request('POST', '/staff/mods/time-changer/hide', { hidden: true });
  await api.request('POST', '/auth/preview', { xuid: '2535400000000101' });
  assert.equal((await api.request('GET', '/me')).body.library.length, 1);
  const selected = (await api.request('GET', '/me')).body.library[0];
  assert.equal((await api.request('POST', '/mods/time-changer/remove', selected)).status, 200);
  assert.deepEqual((await api.request('GET', '/me')).body.library, []);
});

test('preview resends at the same clock value cannot be erased by an older removal', async () => {
  const api = createMockApi({ getItem: () => null, setItem: () => {} }, () => 1234567890000);
  await api.request('POST', '/auth/preview', { xuid: '2535400000000101' });
  await api.request('POST', '/mods/time-changer/send');
  const old = (await api.request('GET', '/me')).body.library[0];
  await api.request('POST', '/mods/time-changer/send');
  assert.equal((await api.request('POST', '/mods/time-changer/remove', old)).status, 409);
  const current = (await api.request('GET', '/me')).body.library[0];
  assert.notEqual(current.sent_at, old.sent_at);
  assert.equal(current.sha256, old.sha256);
  assert.equal((await api.request('POST', '/mods/time-changer/remove', current)).status, 200);
  await api.request('POST', '/mods/time-changer/send');
  assert.equal((await api.request('POST', '/mods/time-changer/remove', old)).status, 409);
});

test('rejects executable gallery data without creating any submission', async () => {
  const api = createMockApi({ getItem: () => null, setItem: () => {} });
  await api.request('POST', '/auth/preview', { xuid: '2535400000000102' });
  const response = await api.request('POST', '/submissions', { slug: 'unsafe-media', name: 'Media', summary: 'A gallery validation example.', version: '1.0.0',
    grants: {}, sha256: 'a'.repeat(64), bytes: 8, gallery: [{ url: 'data:image/svg+xml,<svg/>', caption: '', alt: '' }] });
  assert.equal(response.status, 422);
  assert.equal((await api.request('GET', '/mods/unsafe-media')).status, 404);
});

test('release states and approval readiness fail closed on pending, failed, missing and expired evidence', () => {
  const version = { status: 'submitted', scan: { state: 'complete', review_ready: true, expires_at: Date.now() + 60000,
    report: { deterministic: 'pass', ai: { verdict: 'clear' } } } };
  assert.equal(C.scanApproval(version).ok, true);
  assert.equal(C.releaseState(version).label, 'Awaiting staff review');
  assert.equal(C.scanApproval({ ...version, scan: undefined }).ok, false);
  assert.equal(C.scanApproval({ ...version, scan: { ...version.scan, expires_at: 1 } }).ok, false);
  assert.equal(C.scanApproval({ ...version, scan: { ...version.scan, report: { deterministic: 'block' } } }).ok, false);
  for (const state of ['queued', 'running', 'failed']) assert.equal(C.scanApproval({ ...version, scan: { ...version.scan, state } }).ok, false);
  assert.equal(C.releaseState({ ...version, publication: 'automatic' }).label, 'Publication pending');
  assert.equal(C.releaseState({ ...version, status: 'approved', publication: 'automatic' }).label, 'Published automatically');
  assert.equal(C.releaseState({ ...version, pulled: true }).label, 'Pulled');
});
