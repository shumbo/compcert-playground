# CompCert Playground

A godbolt-style playground for the [CompCert](https://compcert.org) verified C
compiler, running entirely in the browser. Type C code and inspect every
intermediate language CompCert dumps — Parsed C, CompCert C, Clight, Cminor, RTL
(after each optimization pass, with diffs), LTL, Mach and x86-64 assembly — or
copy the program's AST as a Rocq term (Clight or CompCert C, as `clightgen`
produces it).

## How it works

```
 browser main thread                    web worker
┌───────────────────┐  source, flags  ┌──────────────────────────────────────┐
│ React + Monaco UI │ ──────────────▶ │ mcpp.wasm        (Emscripten)        │
│                   │                 │   + CompCert & musl headers          │
│                   │ ◀────────────── │ compcert.js/wasm (wasm_of_ocaml)     │
└───────────────────┘  dumps, errors  │   + in-memory fs shim                │
                                      └──────────────────────────────────────┘
```

- **Compiler.** CompCert v3.18 is configured for `x86_64-linux`, its proofs are
  checked, and the extracted OCaml is compiled to WebAssembly with
  [wasm_of_ocaml](https://ocsigen.org/js_of_ocaml/latest/manual/wasm_overview).
  Instead of the `ccomp` driver, `compiler/playground/PlaygroundCore.ml` runs the
  same pipeline in-process and returns the dumps as strings, plus the
  `clightgen` exports.
- **Preprocessor.** CompCert normally shells out to `gcc -E`. Here that job goes
  to [mcpp](https://mcpp.sourceforge.net/) compiled with Emscripten, which is
  given CompCert's `runtime/include` and musl's x86_64 libc headers, so
  `#include <stdio.h>` works.
- **Filesystem.** wasm_of_ocaml only has file I/O under Node. The build patches
  its loader to use `globalThis.__wasm_of_ocaml_fs`, which the worker provides
  as an in-memory implementation (`web/src/worker/memfs.ts`).

Browser requirements: a recent Chrome, Edge, Firefox or Safari (the compiler
needs WebAssembly GC and exception handling).

## Building

Requirements: Docker, Node.js and pnpm.

```sh
# 1. Build the wasm artifacts into web/public/compcert.  The first run checks
#    all of CompCert's proofs, which takes a while; later runs are cached.
./scripts/build-compiler.sh

# 2. Run the web app.
cd web
pnpm install
pnpm dev            # or: pnpm build  (static site in web/dist)
```

To deploy under a sub-path, build with `BASE_PATH=/compcert-playground/ pnpm build`.
Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`,
which runs the same Docker build (cached between runs).

### Layout

| Path | What |
| --- | --- |
| `compiler/Dockerfile` | toolchain (OCaml 5.3, Rocq 9, wasm_of_ocaml) → CompCert extraction → wasm; mcpp + headers |
| `compiler/playground/PlaygroundCore.ml` | in-process driver: flags, dumps, Rocq export |
| `compiler/playground/playground_js.ml` | JS binding (`globalThis.compcert`) |
| `compiler/playground/build.sh` | patches CompCert's driver for wasm and links everything |
| `web/src/worker/` | worker: preprocessing, compilation, diagnostics, fs shim |
| `web/src/` | UI |

## Notes

- CompCert's `VERSION` file at the `v3.18` tag still reads `3.17`, so generated
  files say "CompCert 3.17". The UI shows the release tag.
- The exported `.v` files compile against CompCert's `Clightdefs` /
  `Csyntaxdefs` (e.g. with VST or an opam `coq-compcert` install).

## Licenses

CompCert is distributed under the
[INRIA Non-Commercial License Agreement](https://github.com/AbsInt/CompCert/blob/master/LICENSE)
(parts under the LGPL), which allows use for education and research but not
commercial use. mcpp is under a BSD-style license, and musl under the MIT
license.
