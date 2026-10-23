const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

/** Provide a controllable worker/clock around the actual browser validation bridge. */
function bridge() {
  const workers = [];
  let timeout;
  class Worker {
    constructor(url, options) { this.url = url; this.options = options; this.stopped = 0; workers.push(this); }
    postMessage(data) { this.data = data; }
    terminate() { this.stopped++; }
  }
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../marketplace-validation.js'), 'utf8'), {
    window, Worker, setTimeout: fn => { timeout = fn; return 1; }, clearTimeout() {}, Error,
  });
  return { validate: window.CinnabarValidation.validate, workers, timeout: () => timeout() };
}

test('a timed-out worker terminates and cannot turn a late result into a pass', async () => {
  const p = bridge();
  const result = p.validate(new ArrayBuffer(8));
  const rejected = assert.rejects(result, /timed out/);
  p.timeout();
  p.workers[0].onmessage({ data: { ok: true, result: {} } });
  await rejected;
  assert.equal(p.workers[0].stopped, 1);
});

test('cancelling a selection or encountering worker startup errors fails closed', async () => {
  const p = bridge();
  const controller = new AbortController();
  const result = p.validate(new ArrayBuffer(8), { signal: controller.signal });
  const cancelled = assert.rejects(result, /cancelled/);
  controller.abort(); await cancelled;
  assert.equal(p.workers[0].stopped, 1);
  const startup = p.validate(new ArrayBuffer(8));
  const failed = assert.rejects(startup, /could not start/);
  p.workers[1].onerror(); await failed;
  assert.equal(p.workers[1].stopped, 1);
});
