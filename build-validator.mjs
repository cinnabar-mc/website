/** Bundle the pinned, trusted parser for a lazy, isolated upload-check worker. */
import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Pass an output directory.');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [join(root, 'marketplace-validator-worker.mjs')],
  outfile: join(output, 'marketplace-validator-worker.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  external: ['node:*'], legalComments: 'eof',
});
const vendor = join(root, 'node_modules/@bytecodealliance/jco-transpile/vendor');
for (const name of ['js-component-bindgen-component.core.wasm', 'js-component-bindgen-component.core2.wasm']) {
  await copyFile(join(vendor, name), join(output, name));
}
await copyFile(join(root, 'node_modules/@bytecodealliance/jco-transpile/LICENSE'), join(output, 'JCO-LICENSE'));
