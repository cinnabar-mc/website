/** Parse component structure with Jco/Wasmtime; never evaluate or instantiate guest code. */
import { $init, generate } from '@bytecodealliance/jco-transpile/component';
/** Validate a complete component and its translated core modules without executing it. */
export async function validateComponent(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 16 * 1024 * 1024) {
    throw new Error('Choose a Wasm component up to 16 MiB.');
  }
  await $init;
  const result = generate(bytes, {
    name: 'upload', noTypescript: true, noNodejsCompat: true,
    instantiation: { tag: 'async' }, base64Cutoff: 0,
  });
  // Generated modules are data. Their bindings are never imported or evaluated.
  for (const [name, module] of result.files) {
    if (name.endsWith('.wasm') && !WebAssembly.validate(module)) {
      throw new Error('The component contains an invalid or unsupported core module.');
    }
  }
  return { imports: result.imports, exports: result.exports.map(([name]) => name) };
}
