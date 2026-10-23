const assert = require('node:assert/strict');
const test = require('node:test');

const M = require('../marketplace-core.js');
const { createMockApi, PERSONAS } = require('../marketplace-mock.js');

const player = { xuid: '1', gamertag: 'Player', role: 'player' };
const creator = { xuid: '2', gamertag: 'Creator', role: 'player' };
const mod1 = { xuid: '3', gamertag: 'ModOne', role: 'moderator' };
const mod2 = { xuid: '4', gamertag: 'ModTwo', role: 'moderator' };
const admin = { xuid: '5', gamertag: 'Admin', role: 'admin' };
const owner = { xuid: '6', gamertag: 'Owner', role: 'owner' };

/** A submitted version with the given grants. */
function version(grants, approvals = []) {
  return { creator: creator.xuid, status: 'submitted', approvals, reach: M.reachOf(grants), grants };
}

/** A mock API over in-memory storage, signed in as a sample persona. */
async function api(gamertag) {
  const store = new Map();
  const client = createMockApi({ getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    () => Date.UTC(2026, 9, 23, 12));
  if (gamertag) {
    const persona = PERSONAS.find(p => p.gamertag === gamertag);
    assert.equal((await client.request('POST', '/auth/preview', { xuid: persona.xuid })).status, 200);
  }
  client.as = async tag => {
    const persona = PERSONAS.find(p => p.gamertag === tag);
    await client.request('POST', '/auth/preview', { xuid: persona.xuid });
  };
  return client;
}

/** Builds a component binary with the given top-level custom sections. */
function component(sections, layer = [0x0d, 0, 1, 0]) {
  const bytes = [0, 0x61, 0x73, 0x6d, ...layer];
  for (const [name, data] of sections) {
    const n = Buffer.from(name);
    const body = [n.length, ...n, ...data];
    bytes.push(0, body.length, ...body);
  }
  return new Uint8Array(bytes);
}

test('files every client grant on exactly one rung', () => {
  assert.equal(M.CAPABILITIES.length, 31);
  assert.equal(new Set(M.CAPABILITIES.map(c => c.name)).size, 31);
  for (const cap of M.CAPABILITIES) assert.ok(cap.rung >= 0 && cap.rung < M.RUNGS.length, cap.name);
  // Every capability the client marks sensitive sits on Acts or Network.
  for (const cap of M.CAPABILITIES.filter(c => c.sensitive)) assert.ok(cap.rung >= 3, cap.name);
});

test('a mod reaches as far as its furthest request', () => {
  assert.equal(M.reachOf(undefined), 0);
  assert.equal(M.reachOf({ environment: true }), 0);
  assert.equal(M.reachOf({ hud: true, player_state: true }), 1);
  assert.equal(M.reachOf({ hud: true, render_through_walls: true }), 2);
  assert.equal(M.reachOf({ commands: [] }), 0);
  assert.equal(M.reachOf({ commands: ['tp'] }), 3);
  assert.equal(M.reachOf({ packets: true, hud: false }), 4);
  assert.throws(() => M.reachOf({ teleport: true }), /Unknown capability/);
  assert.throws(() => M.reachOf({ hud: 'yes' }), /true or false/);
  assert.deepEqual(M.grantDiff({ packets: true, wasi: true }, { packets: true, packet_delay: true }),
    { added: ['packet_delay'], removed: ['wasi'], kept: ['packets'] });
});

test('reach decides how many staff approve and whether one is an admin', () => {
  const looks = version({ hud: true });
  assert.ok(M.can(mod1, 'approve', { version: looks }).ok);
  assert.equal(M.decide(looks, mod1, 'approve', '', 1).status, 'approved');

  const acts = version({ camera: true });
  assert.match(M.can(mod1, 'approve', { version: acts }).reason, /admin/);
  assert.equal(M.decide(acts, admin, 'approve', '', 1).status, 'approved');

  const network = version({ packets: true });
  const first = M.decide(network, mod1, 'approve', '', 1);
  assert.equal(first.status, 'submitted');
  assert.match(M.can(mod2, 'approve', { version: first }).reason, /admin/);
  assert.match(M.can(mod1, 'approve', { version: first }).reason, /already approved/);
  assert.equal(M.decide(first, admin, 'approve', '', 2).status, 'approved');
  const adminFirst = M.decide(network, admin, 'approve', '', 1);
  assert.equal(adminFirst.status, 'submitted');
  assert.equal(M.decide(adminFirst, mod1, 'approve', '', 2).status, 'approved');
});

test('staff cannot review their own mods, and rejections explain themselves', () => {
  const own = Object.assign(version({ hud: true }), { creator: admin.xuid });
  assert.match(M.can(admin, 'approve', { version: own }).reason, /your own/);
  assert.equal(M.can(player, 'review', { version: version({}) }).ok, false);
  assert.equal(M.can(null, 'send').ok, false);
  assert.throws(() => M.decide(version({ hud: true }), mod1, 'reject', ' ', 1), /why/);
  assert.equal(M.decide(version({ hud: true }), mod1, 'changes', 'Fix Escape', 1).status, 'changes');
  const approved = Object.assign(version({}), { status: 'approved' });
  assert.equal(M.can(mod1, 'approve', { version: approved }).ok, false);
});

test('only admins add moderators and only owners add admins', () => {
  assert.equal(M.can(mod1, 'set-role', { target: player, role: 'moderator' }).ok, false);
  assert.ok(M.can(admin, 'set-role', { target: player, role: 'moderator' }).ok);
  assert.ok(M.can(admin, 'set-role', { target: mod1, role: 'player' }).ok);
  assert.equal(M.can(admin, 'set-role', { target: player, role: 'admin' }).ok, false);
  assert.equal(M.can(admin, 'set-role', { target: { ...admin, xuid: '9' }, role: 'player' }).ok, false);
  assert.ok(M.can(owner, 'set-role', { target: mod1, role: 'admin' }).ok);
  assert.equal(M.can(owner, 'set-role', { target: player, role: 'owner' }).ok, false);
  assert.equal(M.can(owner, 'set-role', { target: owner, role: 'player' }).ok, false);
  assert.equal(M.can(admin, 'pull').ok, true);
  assert.equal(M.can(mod1, 'pull').ok, false);
});

test('listings need a source link once a mod can act or touch the network', () => {
  const base = { slug: 'zoom', name: 'Zoom', summary: 'Zooms the camera in.', version: '1.0.0' };
  assert.deepEqual(M.validateListing({ ...base, reach: 1 }), {});
  assert.ok(M.validateListing({ ...base, reach: 3 }).source);
  assert.deepEqual(M.validateListing({ ...base, reach: 4, source: 'https://github.com/a/zoom' }), {});
  const bad = M.validateListing({ slug: 'Zoom!', name: '', summary: 'short', version: 'v1', source: 'http://x', reach: 0 });
  assert.deepEqual(Object.keys(bad).sort(), ['name', 'slug', 'source', 'summary', 'version']);
});

test('routes come from the hash so static hosting serves every view', () => {
  assert.deepEqual(M.parseRoute(''), { view: 'catalogue' });
  assert.deepEqual(M.parseRoute('#/?reach=2'), { view: 'catalogue' });
  assert.deepEqual(M.parseRoute('#/mod/time-changer'), { view: 'mod', slug: 'time-changer' });
  assert.deepEqual(M.parseRoute('#/staff'), { view: 'staff', tab: 'queue', id: undefined });
  assert.deepEqual(M.parseRoute('#/staff/queue/v4'), { view: 'staff', tab: 'queue', id: 'v4' });
  assert.deepEqual(M.parseRoute('#/staff/people'), { view: 'staff', tab: 'people', id: undefined });
  assert.deepEqual(M.parseRoute('#/nope'), { view: 'catalogue' });
});

test('reads metadata and grant requests from a component without running it', () => {
  const name = [0, 6, 5, ...Buffer.from('Zoomy')];
  const parsed = M.readComponent(component([
    ['component-name', name],
    ['version', Buffer.from('1.4.0')],
    ['description', Buffer.from('Zooms.')],
    ['cinnabar:grants', Buffer.from('{"camera":true,"hud":false}')],
  ]));
  assert.equal(parsed.name, 'Zoomy');
  assert.equal(parsed.version, '1.4.0');
  assert.deepEqual(parsed.grants, { camera: true, hud: false });
  assert.equal(M.reachOf(parsed.grants), 3);
  assert.equal(M.readComponent(component([])).grantsDeclared, false);
  assert.throws(() => M.readComponent(component([], [1, 0, 0, 0])), /core module/);
  assert.throws(() => M.readComponent(new Uint8Array([1, 2, 3])), /WebAssembly/);
  assert.throws(() => M.readComponent(component([['cinnabar:grants', Buffer.from('{"fly":true}')]])), /Unknown capability/);
  assert.throws(() => M.readComponent(component([['version', Buffer.from('1')]]).slice(0, 12)), /Truncated/);
});

test('a submission stays private until staff approve it, then anyone can send it', async () => {
  const client = await api();
  assert.equal((await client.request('POST', '/mods/time-changer/send')).status, 401);
  await client.as('BlockSmith42');
  const sha256 = 'a'.repeat(64);
  const listing = { slug: 'compass', name: 'Compass', summary: 'A compass strip at the top.', version: '0.1.0',
    grants: { hud: true, player_state: true }, sha256, bytes: 1200 };
  const submitted = await client.request('POST', '/submissions', listing);
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.status, 'submitted');
  assert.equal((await client.request('GET', '/mods/compass')).status, 404);
  assert.equal((await client.request('GET', '/staff/queue')).status, 403);
  assert.equal((await client.request('POST', '/submissions', listing)).status, 409);

  await client.as('PixelWarden');
  const queue = (await client.request('GET', '/staff/queue')).body;
  const entry = queue.find(v => v.slug === 'compass');
  assert.equal(entry.reach, 1);
  const decided = await client.request('POST', `/staff/versions/${entry.id}/decision`, { decision: 'approve' });
  assert.equal(decided.body.status, 'approved');

  await client.as('MossyCobble');
  const live = await client.request('GET', '/mods/compass');
  assert.equal(live.body.reviewed_by, 'PixelWarden');
  assert.deepEqual(live.body.capabilities, ['hud', 'player_state']);
  assert.equal((await client.request('POST', '/mods/compass/send')).status, 200);
  assert.deepEqual((await client.request('GET', '/me')).body.library.map(e => e.slug), ['compass']);
  const audit = await client.request('GET', '/staff/audit');
  assert.equal(audit.status, 403);
});

test('another creator cannot take over a listing name', async () => {
  const client = await api('MossyCobble');
  const result = await client.request('POST', '/submissions', { slug: 'time-changer', name: 'Mine', summary: 'Not the real one at all.',
    version: '9.0.0', grants: {}, sha256: 'b'.repeat(64), bytes: 10 });
  assert.equal(result.status, 409);
  assert.ok(result.body.fields.slug);
});

test('the server enforces review rules even when the page would allow a click', async () => {
  const client = await api('PixelWarden');
  const queue = (await client.request('GET', '/staff/queue')).body;
  const chat = queue.find(v => v.slug === 'chat-tweaks');
  const denied = await client.request('POST', `/staff/versions/${chat.id}/decision`, { decision: 'approve' });
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /admin/);
  const party = queue.find(v => v.slug === 'party-sync');
  assert.deepEqual(party.previous.diff.added, ['packet_delay']);
  await client.as('RedstoneRook');
  assert.equal((await client.request('POST', `/staff/versions/${party.id}/decision`, { decision: 'approve' })).body.status, 'approved');
  assert.equal((await client.request('GET', '/mods/party-sync')).body.version, '0.4.0');
});

test('pulling a version removes it from the catalogue and the audit log records who and why', async () => {
  const client = await api('PixelWarden');
  const keystrokes = (await client.request('GET', '/mods/keystrokes')).body;
  assert.equal((await client.request('POST', `/staff/versions/${keystrokes.version_id}/pull`, { reason: 'Broken' })).status, 403);
  await client.as('RedstoneRook');
  assert.equal((await client.request('POST', `/staff/versions/${keystrokes.version_id}/pull`, { reason: '' })).status, 400);
  assert.equal((await client.request('POST', `/staff/versions/${keystrokes.version_id}/pull`, { reason: 'Covers the hotbar' })).status, 200);
  assert.equal((await client.request('GET', '/mods/keystrokes')).status, 404);
  const audit = (await client.request('GET', '/staff/audit')).body;
  assert.deepEqual([audit[0].actor_name, audit[0].action, audit[0].target, audit[0].note],
    ['RedstoneRook', 'pulled', 'keystrokes 1.1.0', 'Covers the hotbar']);
  await client.request('POST', '/staff/mods/clear-skies/hide', { hidden: true, reason: 'Checking a report' });
  assert.equal((await client.request('GET', '/mods')).body.some(m => m.slug === 'clear-skies'), false);
});

test('role changes follow the account and need a reason', async () => {
  const client = await api('RedstoneRook');
  assert.equal((await client.request('POST', '/staff/people/role', { gamertag: 'MossyCobble', role: 'admin', reason: 'x' })).status, 403);
  assert.equal((await client.request('POST', '/staff/people/role', { gamertag: 'MossyCobble', role: 'moderator', reason: '' })).status, 400);
  assert.equal((await client.request('POST', '/staff/people/role', { gamertag: 'nobody', role: 'moderator', reason: 'x' })).status, 404);
  const promoted = await client.request('POST', '/staff/people/role', { gamertag: 'mossycobble', role: 'moderator', reason: 'Helps in Discord' });
  assert.equal(promoted.body.role, 'moderator');
  await client.as('MossyCobble');
  assert.equal((await client.request('GET', '/staff/queue')).status, 200);
  assert.equal((await client.request('GET', '/me')).body.account.role, 'moderator');
});

test('reports need a signed-in player, a reason and details', async () => {
  const client = await api();
  assert.equal((await client.request('POST', '/mods/freelook/reports', { reason: 'broken', details: 'Camera sticks.' })).status, 401);
  await client.as('MossyCobble');
  assert.equal((await client.request('POST', '/mods/freelook/reports', { reason: 'nope', details: 'Camera sticks after Alt.' })).status, 400);
  assert.equal((await client.request('POST', '/mods/freelook/reports', { reason: 'broken', details: 'short' })).status, 400);
  assert.equal((await client.request('POST', '/mods/freelook/reports', { reason: 'broken', details: 'Camera sticks after Alt.' })).status, 200);
  await client.as('PixelWarden');
  const reports = (await client.request('GET', '/staff/reports')).body;
  assert.equal(reports[0].slug, 'freelook');
  assert.equal((await client.request('POST', `/staff/reports/${reports[0].id}/resolve`, { note: '' })).status, 400);
  assert.equal((await client.request('POST', `/staff/reports/${reports[0].id}/resolve`, { note: 'Fixed in 0.9.1' })).body.status, 'resolved');
});

test('the live client sends the session cookie, repeats the CSRF token and uploads components as forms', async () => {
  const { createHttpApi } = require('../marketplace-http.js');
  const calls = [];
  const replies = [{ account: { gamertag: 'Steve' }, csrf: 'token-1' }, { id: '12', status: 'submitted' }];
  const location = { href: 'https://site.test/mods/#/submit', assign: url => calls.push({ assigned: url }) };
  const client = createHttpApi('https://api.test/v1', async (url, init) => {
    calls.push({ url, init });
    return { status: 200, json: async () => replies.shift() };
  }, location);
  await client.request('GET', '/me');
  const file = new File([new Uint8Array([0, 0x61, 0x73, 0x6d])], 'compass.wasm');
  const result = await client.submit({ slug: 'compass', version: '0.1.0' }, file);
  assert.equal(result.body.status, 'submitted');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['X-Cinnabar-CSRF'], undefined);
  assert.equal(calls[1].url, 'https://api.test/v1/submissions');
  assert.equal(calls[1].init.headers['X-Cinnabar-CSRF'], 'token-1');
  assert.equal(calls[1].init.headers['Content-Type'], undefined);
  assert.ok(calls[1].init.body instanceof FormData);
  assert.deepEqual(JSON.parse(calls[1].init.body.get('listing')), { slug: 'compass', version: '0.1.0' });
  assert.equal(calls[1].init.body.get('file').name, 'compass.wasm');
  client.signIn();
  assert.equal(calls[2].assigned, 'https://api.test/v1/auth/microsoft/start?return_to=' + encodeURIComponent(location.href));
});
