(function (root) {
  'use strict';
  /** Run a disposable trusted validator with a deadline; uploaded code is never instantiated. */
  function validate(buffer, options = {}) {
    return new Promise(function (resolve, reject) {
      if (options.signal?.aborted) { reject(new Error('Validation cancelled.')); return; }
      const worker = new Worker('/validator/marketplace-validator-worker.js', { type: 'module' });
      let finished = false;
      const finish = function (error, result) {
        if (finished) return;
        finished = true;
        options.signal?.removeEventListener('abort', abort);
        clearTimeout(timer); worker.terminate();
        if (error) reject(error); else resolve(result);
      };
      const abort = function () { finish(new Error('Validation cancelled.')); };
      const timer = setTimeout(function () { finish(new Error('Validation timed out. Try a smaller component or retry.')); }, 20000);
      options.signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = function (event) {
        finish(event.data.ok ? null : new Error(event.data.error), event.data.result);
      };
      worker.onerror = function () { finish(new Error('The component validator could not start. Refresh and retry.')); };
      worker.postMessage(buffer, [buffer]);
    });
  }
  root.CinnabarValidation = { validate: validate };
})(window);
