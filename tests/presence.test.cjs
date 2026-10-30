const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../presence.js'), 'utf8');

/** Runs presence updates with controlled responses, visibility and scheduled callbacks. */
async function page(reply = {online: 42}, hidden = false) {
  const label = {textContent: ''};
  const unique = {textContent: ''};
  const listeners = {};
  const timers = new Map();
  const requests = [];
  let response = reply;
  let timerId = 0;
  const document = {hidden, getElementById: id => id === 'unique-count' ? unique : label,
    addEventListener: (name, callback) => { (listeners[name] ??= []).push(callback); }};
  const window = {CINNABAR_DOWNLOADS: {online_count_url: 'https://api.invalid/v1/presence/count',
    unique_count_url: 'https://api.invalid/v1/users/count'},
    setTimeout(callback, delay) { timers.set(++timerId, {callback, delay}); return timerId; },
    clearTimeout(id) { timers.delete(id); }};
  vm.runInNewContext(source, {document, window, AbortSignal,
    async fetch(url, options) {
      requests.push({url, options});
      const current = typeof response === 'function' ? response(url) : response;
      if (current instanceof Error) throw current;
      return {ok: current !== 'http-error', json: async () => current};
    }});
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return {label, unique, requests, timers,
    async refresh(next) {
      response = next;
      const callbacks = [...timers.values()];
      assert.ok(callbacks.length);
      timers.clear();
      await Promise.all(callbacks.map(timer => timer.callback()));
    },
    async visible(value) {
      document.hidden = !value;
      listeners.visibilitychange.forEach(callback => callback());
      await settle();
    }};
}

test('bypasses browser caching on every poll so the count follows new samples', async () => {
  const p = await page({online: 1});
  assert.equal(p.requests[0].options.cache, 'no-store');
  await p.refresh({online: 19});
  assert.equal(p.requests[2].options.cache, 'no-store');
  assert.equal(p.label.textContent, '19 people are using Cinnabar right now');
});

test('shows live counts with singular, plural, zero and formatted numbers', async () => {
  const p = await page();
  assert.equal(p.label.textContent, '42 people are using Cinnabar right now');
  assert.equal(p.requests[0].url, 'https://api.invalid/v1/presence/count');
  assert.equal(p.requests[0].options.credentials, 'omit');
  assert.equal(p.requests[0].options.referrerPolicy, 'no-referrer');
  assert.ok(p.requests[0].options.signal instanceof AbortSignal);
  assert.equal([...p.timers.values()][0].delay, 60_000);
  await p.refresh({online: 1});
  assert.equal(p.label.textContent, '1 person is using Cinnabar right now');
  await p.refresh({online: 0});
  assert.equal(p.label.textContent, '0 people are using Cinnabar right now');
  await p.refresh({online: 12345});
  assert.equal(p.label.textContent, `${(12345).toLocaleString()} people are using Cinnabar right now`);
});

test('clears stale counts on errors or invalid payloads and recovers on the next poll', async () => {
  for (const invalid of [new Error('offline'), new DOMException('timeout', 'TimeoutError'),
    'http-error', null, {}, {online: -1}, {online: 1.5}, {online: '2'},
    {online: Number.MAX_SAFE_INTEGER + 1}, {online: '<script>'}]) {
    const p = await page();
    await p.refresh(invalid);
    assert.equal(p.label.textContent, '');
    await p.refresh({online: 2});
    assert.equal(p.label.textContent, '2 people are using Cinnabar right now');
  }
});

test('pauses polling in background tabs and refreshes on return', async () => {
  const p = await page({online: 2}, true);
  assert.equal(p.requests.length, 0);
  assert.equal(p.timers.size, 0);
  await p.visible(true);
  assert.equal(p.requests.length, 2);
  assert.equal(p.timers.size, 2);
  await p.visible(false);
  assert.equal(p.label.textContent, '');
  assert.equal(p.timers.size, 0);
  await p.visible(true);
  assert.equal(p.requests.length, 4);
  assert.equal(p.label.textContent, '2 people are using Cinnabar right now');
});


test('shows unique users independently with zero, singular and formatted totals', async () => {
  const p = await page({online: 4, unique: 1});
  assert.equal(p.unique.textContent, '1 unique user');
  assert.equal(p.requests[1].url, 'https://api.invalid/v1/users/count');
  assert.equal(p.requests[1].options.cache, 'no-store');
  assert.equal(p.requests[1].options.credentials, 'omit');
  await p.refresh({online: 0, unique: 0});
  assert.equal(p.unique.textContent, '0 unique users');
  await p.refresh({online: 1, unique: 12345});
  assert.equal(p.unique.textContent, `${(12345).toLocaleString()} unique users`);
  await p.visible(false);
  assert.equal(p.unique.textContent, '');
  assert.equal(p.timers.size, 0);
  await p.visible(true);
  assert.notEqual(p.unique.textContent, '');
});

test('invalid or missing unique totals clear only that count and recover', async () => {
  const p = await page({online: 2, unique: 42});
  for (const unique of [undefined, null, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1, '<script>']) {
    await p.refresh({online: 2, unique});
    assert.equal(p.unique.textContent, '');
    assert.equal(p.label.textContent, '2 people are using Cinnabar right now');
    await p.refresh({online: 2, unique: 42});
    assert.equal(p.unique.textContent, '42 unique users');
  }
  await p.refresh({unique: 42});
  assert.equal(p.label.textContent, '');
  assert.notEqual(p.unique.textContent, '');
  await p.refresh(new Error('offline'));
  assert.equal(p.unique.textContent, '');
});


test('an unavailable unique-user endpoint leaves the online count working', async () => {
  const p = await page(url => url.endsWith('/users/count') ? new Error('offline') : {online: 4});
  assert.equal(p.unique.textContent, '');
  assert.equal(p.label.textContent, '4 people are using Cinnabar right now');
  await p.refresh({online: 4, unique: 40});
  assert.equal(p.unique.textContent, '40 unique users');
});
