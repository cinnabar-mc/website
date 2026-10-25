/** Keep expensive parser work off the page and expose no guest execution path. */
import { validateComponent } from './marketplace-validator-engine.mjs';
self.onmessage = async ({ data }) => {
  try {
    const result = await validateComponent(new Uint8Array(data));
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error?.message || error).slice(0, 800) });
  }
};
