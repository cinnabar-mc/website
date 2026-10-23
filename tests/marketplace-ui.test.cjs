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
  const win = { CinnabarMarket: M, CinnabarContent: C, CinnabarMarketMock: Mock,
    CinnabarMarketHttp: { createHttpApi: () => http },
    CINNABAR_DOWNLOADS: { marketplace: { backend: http ? 'http' : 'mock', api_url: 'https://api.invalid/v1' } }, localStorage: storage,
    CinnabarValidation: { validate: async () => ({ imports: [], exports: [] }) },
    addEventListener: (name, fn) => { listeners[name] = fn; }, scrollTo() {}, fetch() {}, location };
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
  return { window, document, memory, win, route, click, input, signIn, text: () => document.getElementById('app').textContent };
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
