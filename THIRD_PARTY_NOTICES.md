# Third-party notices

The Cinnabar website and original branding retain the existing PolyForm
Noncommercial 1.0.0 license in [LICENSE](LICENSE).

Component upload preflight uses pinned
[@bytecodealliance/jco-transpile](https://github.com/bytecodealliance/jco)
and Bytecode Alliance Preview 2 browser shims, under Apache-2.0 WITH LLVM-exception.
The build retains their full license at `dist/validator/JCO-LICENSE`, served as
`/validator/JCO-LICENSE`, and their existing bundled source notices. The validator
Wasm comes from the pinned package; no uploaded mod code is bundled into the site.

esbuild (MIT) is a build-time dependency and LinkeDOM (ISC) is a test-time dependency;
neither is shipped as application code. Exact versions and integrity hashes are
recorded in package-lock.json.
