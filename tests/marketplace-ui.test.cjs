const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
const { parseHTML } = require('linkedom');
const M = require('../marketplace-core.js');
const C = require('../marketplace-content.js');
const Mock = require('../marketplace-mock.js');
const root = path.join(__dirname, '..');

/** Settle the controller's short chain of asynchronous API requests. */
async function settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }

/** Exercise the real controller against a DOM and the actual mock transport. */
async function page(hash = '#/', stored, http) {
  const { window, document } = parseHTML(fs.readFileSync(path.join(root, 'dist/mods/index.html'), 'utf8'));
  const memory = stored || new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const location = { hash, search: '', pathname: '/mods/' };
  // LinkeDOM deliberately omits navigation, layout and focus; model only those browser primitives.
  Object.defineProperty(document, 'activeElement', { value: document.body, writable: true });
  window.HTMLElement.prototype.focus = function () { if (this.isConnected) document.activeElement = this; };
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return [...this.querySelectorAll('option')].find(option => option.hasAttribute('selected'))?.value || this.querySelector('option')?.value || ''; },
    set(value) { this.querySelectorAll('option').forEach(option => value === option.value ? option.setAttribute('selected', '') : option.removeAttribute('selected')); },
  });
  window.HTMLElement.prototype.showModal = function () { this.open = true; };
  window.HTMLElement.prototype.close = function () { this.open = false; };
  const listeners = {};
  const timers = new Map(); let timerId = 0;
  const win = { CinnabarMarket: M, CinnabarContent: C, CinnabarMarketMock: Mock,
    CinnabarMarketHttp: { createHttpApi: () => http },
    CINNABAR_DOWNLOADS: { marketplace: { backend: http ? 'http' : 'mock', api_url: 'https://api.invalid/v1' } }, localStorage: storage,
    CinnabarValidation: { validate: async () => ({ imports: [], exports: [] }) },
    addEventListener: (name, fn) => { listeners[name] = fn; }, scrollTo() {}, fetch() {}, location,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'marketplace.js'), 'utf8'), {
    window: win, document, location, history: { replaceState() {} }, URLSearchParams, URL,
    crypto: webcrypto, AbortController, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer,
  });
  await settle();
  /** Change routes exactly as a browser hashchange would. */
  async function route(hash) { location.hash = hash; listeners.hashchange(); await settle(); }
  /** Activate a connected control and settle its transport effects. */
  async function click(element) { assert.ok(element, 'control exists'); element.focus(); element.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })); await settle(); }
  /** Enter a value without rerendering the focused input. */
  async function input(selector, value) { const element = document.querySelector(selector); element.value = value; element.focus(); element.dispatchEvent(new window.Event('input', { bubbles: true })); await settle(); }
  /** Select a fictional persona through the actual sign-in dialogue. */
  async function signIn(name) { await click(document.querySelector('#account button')); await click([...document.querySelectorAll('#signin-body button')].find(button => button.textContent.includes(name))); }
  async function tick() { const queued = [...timers.values()]; timers.clear(); for (const fn of queued) await fn(); await settle(); }
  return { window, document, memory, win, route, click, input, signIn, tick, timers, text: () => document.getElementById('app').textContent };
}

test('search retains input focus, category state survives a detail round trip, and gallery absence is explicit', async () => {
  const p = await page();
  assert.equal(p.document.querySelectorAll('.mod-card').length, 8);
  await p.input('#mod-search', 'coords');
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
  assert.equal(p.document.activeElement.id, 'mod-search');
  await p.route('#/mod/coords-hud');
  assert.match(p.text(), /No screenshots uploaded/);
  await p.route('#/');
  assert.equal(p.document.querySelector('#mod-search').value, 'coords');
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
});

test('library selections are isolated by identity and removal keeps a usable focus target', async () => {
  const p = await page();
  await p.signIn('MossyCobble');
  await p.route('#/mod/time-changer');
  await p.click(p.document.querySelector('[data-focus-key="project:add"]'));
  await p.route('#/library');
  assert.equal(p.document.querySelectorAll('.mod-card').length, 1);
  await p.click(p.document.querySelector('[data-focus-key="remove:time-changer"]'));
  assert.match(p.text(), /Your library is empty/);
  assert.equal(p.document.activeElement.isConnected, true);
  await p.signIn('BlockSmith42');
  assert.match(p.text(), /Your library is empty/);
});

test('draft steps preserve content, preview escapes HTML, and another account cannot read a saved draft', async () => {
  const p = await page('#/submit');
  await p.signIn('BlockSmith42');
  await p.input('#draft-name', 'Creator draft');
  await p.input('#draft-description', '## Heading\n<script>alert(1)</script>');
  await p.click(p.document.querySelector('[data-focus-key="draft:preview"]'));
  assert.equal(p.document.querySelector('#app script'), null);
  assert.equal(p.document.querySelector('.markdown h2').textContent, 'Heading');
  await p.click(p.document.querySelector('[data-focus-key="step:media"]'));
  await p.click(p.document.querySelector('[data-focus-key="step:project"]'));
  assert.equal(p.document.querySelector('#draft-name').value, 'Creator draft');
  await p.click(p.document.querySelector('[data-focus-key="draft:save"]'));
  await p.signIn('MossyCobble');
  assert.equal(p.document.querySelector('#draft-name').value, '');
  await p.signIn('BlockSmith42');
  assert.equal(p.document.querySelector('#draft-name').value, 'Creator draft');
});

test('a stale file check cannot replace a newer selection or authorize submission', async () => {
  const p = await page('#/submit'); await p.signIn('BlockSmith42');
  const checks = [];
  p.win.CinnabarValidation.validate = (bytes, options) => new Promise((resolve, reject) => {
    checks.push({ resolve }); options.signal.addEventListener('abort', () => reject(new Error('cancelled')));
  });
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  const fileInput = p.document.querySelector('input[type=file]');
  const buffer = Uint8Array.from([0, 97, 115, 109, 13, 0, 1, 0]).buffer;
  /** Select an immutable component-like file through the real input handler. */
  async function select(name) {
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ name, size: 8, arrayBuffer: async () => buffer.slice(0) }] });
    fileInput.dispatchEvent(new p.window.Event('change'));
    for (let i = 0; i < 20 && checks.length < (name === 'old.wasm' ? 1 : 2); i++) await new Promise(resolve => setTimeout(resolve, 5));
  }
  await select('old.wasm'); await select('new.wasm');
  checks[0].resolve({ imports: [], exports: [] }); await settle();
  assert.doesNotMatch(p.text(), /old.wasm · syntax checked/);
  checks[1].resolve({ imports: [], exports: [] }); await settle();
  assert.match(p.text(), /new.wasm · syntax checked/);
});

test('staff queue shows exact command changes and rejected decisions preserve their note', async () => {
  const memory = new Map();
  const api = Mock.createMockApi({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) });
  await api.request('GET', '/me');
  const state = JSON.parse(memory.get(Mock.STORAGE_KEY));
  const old = state.versions.find(version => version.slug === 'coords-hud' && version.status === 'approved');
  const next = state.versions.find(version => version.slug === 'coords-hud' && version.status === 'submitted');
  old.grants = { hud: true, commands: ['say'] }; old.reach = 3;
  next.grants = { hud: true, commands: ['op'] }; next.reach = 3;
  memory.set(Mock.STORAGE_KEY, JSON.stringify(state));
  const p = await page('#/staff/queue/' + next.id, memory);
  await p.signIn('RedstoneRook');
  assert.match(p.text(), /Server scan evidence is not connected/);
  assert.match(p.text(), /Commands added: op/);
  assert.match(p.text(), /Commands removed: say/);
  const request = p.document.querySelector('[data-focus-key="decision:changes"]');
  await p.click(request);
  assert.match(p.text(), /Tell the creator why/);
  assert.equal(p.document.activeElement.id, 'review-note');
});

test('an older HTTP API cannot approve command updates from a name-only diff', async () => {
  const memory = new Map();
  const api = Mock.createMockApi({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) });
  await api.request('POST', '/auth/preview', { xuid: '2535400000000301' });
  const state = JSON.parse(memory.get(Mock.STORAGE_KEY));
  const next = state.versions.find(version => version.slug === 'coords-hud' && version.status === 'submitted');
  next.grants = { hud: true, commands: ['op'] }; next.reach = 3;
  memory.set(Mock.STORAGE_KEY, JSON.stringify(state));
  const server = Mock.createMockApi({ getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) });
  const http = { backend: 'http', request: async (...args) => {
    const result = await server.request(...args);
    if (result.body.previous) { delete result.body.previous.grants; delete result.body.previous.diff.commands; }
    return result;
  } };
  const p = await page('#/staff/queue/' + next.id, memory, http);
  assert.equal(p.document.querySelector('[data-focus-key="decision:approve"]').disabled, true);
  assert.match(p.text(), /does not provide the previous command values/);
  assert.equal(p.document.querySelector('#preview-note').hidden, true);
});

test('resolved reports do not expose a pull action without an editable reason', async () => {
  const p = await page('#/staff/reports'); await p.signIn('RedstoneRook');
  const pulls = [...p.document.querySelectorAll('#app button')].filter(control => control.textContent === 'Pull release');
  assert.equal(pulls.length, 1);
  assert.ok(pulls[0].closest('article').querySelector('textarea'));
});

/** A normalized live API release; all outcomes below come from response fixtures, never UI simulation. */
function liveRelease(state = 'queued') {
  return { id: '42', slug: 'live-mod', name: 'Live mod', version: '1.0.0', status: 'submitted',
    creator: 'creator', creator_name: 'Creator', approvals: [], grants: { hud: true }, capabilities: ['hud'], reach: 0,
    description: '## HUD\n<script>unsafe()</script>', sha256: 'a'.repeat(64), gallery: [], publication: null,
    scan: { state, review_ready: state === 'complete', completed_at: Date.now(), expires_at: Date.now() + 60000,
      report: state === 'complete' ? { deterministic: 'pass', validator: 'test-validator', policy: 'test-policy',
        findings: [], ai: { verdict: 'clear', model: 'test-model', prompt: 'test-prompt', findings: [] } } : null } };
}

/** HTTP-shaped fixture keeps session, reads and mutation responses observable. */
function liveApi(version, role = 'moderator') {
  const calls = [];
  const api = { backend: 'http', calls, account: { xuid: role === 'player' ? 'creator' : 'staff', gamertag: 'Signed in', role },
    fileUrl: id => 'https://api.invalid/v1/staff/versions/' + id + '/file',
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path === '/me') return { status: 200, body: { account: api.account, library: [] } };
      if (path === '/mods') return { status: 200, body: [] };
      if (path === '/me/mods') return { status: 200, body: [structuredClone(version)] };
      if (path === '/staff/queue') return { status: 200, body: version.status === 'submitted' ? [structuredClone(version)] : [] };
      if (path === '/staff/versions/42') return { status: 200, body: structuredClone(version) };
      return { status: 403, body: { error: 'A fresh sign-in is required.' } };
    } };
  return api;
}

test('live review requires server readiness and explanatory notes for AI flags, with inert evidence', async () => {
  const version = liveRelease('queued');
  const api = liveApi(version);
  const p = await page('#/staff/queue/42', undefined, api);
  assert.equal(p.document.querySelector('[data-focus-key="decision:approve"]').disabled, true);
  assert.match(p.text(), /Queued for scanning/);
  assert.equal(p.document.querySelector('#app script'), null);
  Object.assign(version, liveRelease('complete'));
  version.scan.report.ai = { verdict: 'flag', findings: ['<img src=x onerror=unsafe()>'], model: 'review-model', prompt: 'v1' };
  await p.tick();
  assert.match(p.text(), /Flagged for staff review/);
  assert.equal(p.document.querySelector('.scan-findings img'), null);
  assert.equal(p.document.querySelector('[data-focus-key="decision:approve"]').disabled, true);
  await p.input('#review-note', 'Inspected the artifact and resolved the flagged string.');
  assert.equal(p.document.querySelector('[data-focus-key="decision:approve"]').disabled, false);
  await p.click(p.document.querySelector('[data-focus-key="decision:approve"]'));
  assert.match(p.text(), /A fresh sign-in is required/);
  await p.tick();
  assert.equal(p.document.querySelector('#review-note').value, 'Inspected the artifact and resolved the flagged string.');
  assert.equal(p.document.activeElement.id, 'review-note');
});

test('creator status refreshes through scanning and automatic publication, pausing when hidden or navigating', async () => {
  const version = liveRelease(); const api = liveApi(version, 'player');
  const p = await page('#/mine/42', undefined, api);
  assert.match(p.text(), /Queued for scanning/);
  version.scan.state = 'running'; await p.tick(); assert.match(p.text(), /Scanning/);
  version.status = 'approved'; version.publication = 'automatic'; await p.tick();
  assert.match(p.text(), /Published automatically/);
  Object.defineProperty(p.document, 'hidden', { configurable: true, value: true });
  p.document.dispatchEvent(new p.window.Event('visibilitychange'));
  assert.equal(p.timers.size, 0);
  Object.defineProperty(p.document, 'hidden', { configurable: true, value: false });
  p.document.dispatchEvent(new p.window.Event('visibilitychange'));
  assert.equal(p.timers.size, 1);
  await p.route('#/'); assert.equal(p.timers.size, 0);
});

test('status refresh preserves review notes on network errors and removes staff controls after session expiry', async () => {
  const version = liveRelease('complete'); const api = liveApi(version);
  const p = await page('#/staff/queue/42', undefined, api);
  await p.input('#review-note', 'Unfinished review note');
  const original = api.request;
  api.request = async (method, path, body) => path === '/me' ? { status: 503, body: { error: 'Offline' } } : original(method, path, body);
  await p.tick();
  assert.match(p.text(), /Status could not refresh/);
  assert.equal(p.document.querySelector('#review-note').value, 'Unfinished review note');
  api.request = original; api.account = null; await p.tick();
  assert.equal(p.document.querySelector('[data-focus-key="decision:approve"]'), null);
  assert.match(p.text(), /Sign in with a moderator/);
});

test('failed real uploads retain local images and description and forward the complete draft', async () => {
  const version = liveRelease(); const api = liveApi(version, 'player');
  const memory = new Map([['cinnabar.marketplace.draft.creator', JSON.stringify({ name: 'Upload test', slug: 'upload-test',
    summary: 'A complete live upload fixture.', description: 'Long description retained', version: '1.0.0', category: 'Interface',
    license: 'MIT', notes: 'Initial release', source: '', gallery: [{ url: 'data:image/png;base64,AQID', caption: 'HUD', alt: 'Coordinates' }] })]]);
  let uploaded;
  api.submit = async (fields, file, gallery) => { uploaded = { fields, file, gallery }; return { status: 413, body: { error: 'Upload rejected. Resize and retry.' } }; };
  const p = await page('#/submit', memory, api);
  await p.click(p.document.querySelector('[data-focus-key="step:release"]'));
  const input = p.document.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { value: [{ name: 'test.wasm', size: 8,
    arrayBuffer: async () => Uint8Array.from([0,97,115,109,13,0,1,0]).buffer }] });
  input.dispatchEvent(new p.window.Event('change'));
  for (let i = 0; i < 20 && !p.text().includes('syntax checked'); i++) { await new Promise(resolve => setTimeout(resolve, 5)); await settle(); }
  await p.click(p.document.querySelector('[data-focus-key="step:checks"]'));
  p.document.querySelector('#distribution-rights').checked = true;
  p.document.querySelector('form').dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true })); await settle();
  assert.match(p.document.querySelector('#feedback').textContent, /Resize and retry/);
  assert.equal(uploaded.fields.license, 'MIT'); assert.equal(uploaded.fields.notes, 'Initial release');
  assert.equal(uploaded.gallery[0].alt, 'Coordinates');
  await p.click(p.document.querySelector('[data-focus-key="step:project"]'));
  assert.equal(p.document.querySelector('#draft-description').value, 'Long description retained');
  await p.click(p.document.querySelector('[data-focus-key="step:media"]'));
  assert.equal(p.document.querySelectorAll('.media-item').length, 1);
});
