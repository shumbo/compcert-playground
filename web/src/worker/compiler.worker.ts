// Runs mcpp (Emscripten) and CompCert (wasm_of_ocaml) off the main thread.

import { createMemFs } from './memfs';
import type { CompileRequest, CompileResult, Diagnostic, WorkerMessage } from './protocol';

type CompcertOutput = { ok: boolean; diagnostics: string; dumps: Record<string, string> };
type Compcert = {
  version: string;
  compile(filename: string, source: string, args: string[]): CompcertOutput;
  exportRocq(
    filename: string, source: string, args: string[], mode: string, normalize: boolean,
  ): CompcertOutput;
};

type EmscriptenModule = {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: string): void;
    readFile(path: string, opts: { encoding: 'utf8' }): string;
    chdir(path: string): void;
  };
  callMain(args: string[]): number;
};
type McppFactory = (opts: object) => Promise<EmscriptenModule>;

const post = (msg: WorkerMessage) => (self as unknown as Worker).postMessage(msg);

// Everything the compiler writes to stdout/stderr ends up here.
let stdio = '';
const memfs = createMemFs({ out: (s) => (stdio += s), err: (s) => (stdio += s) });

let compcert: Compcert;
let createMcpp: McppFactory;
let mcppWasm: WebAssembly.Module;
let headers: Record<string, string>;
let version = '';

async function init(base: string) {
  const g = globalThis as Record<string, unknown>;
  g.__wasm_of_ocaml_fs = memfs;
  g.__wasm_of_ocaml_base = base;

  // compcert.js sets globalThis.compcert once the OCaml program has run.
  const compcertReady = new Promise<Compcert>((resolve, reject) => {
    Object.defineProperty(globalThis, 'compcert', {
      configurable: true,
      set(v: Compcert) {
        Object.defineProperty(globalThis, 'compcert', { value: v, configurable: true });
        resolve(v);
      },
    });
    self.addEventListener('unhandledrejection', (e) => reject(e.reason));
    self.addEventListener('error', (e) => reject(e.error ?? e.message));
  });

  const [mcppModule, wasm, hdrs] = await Promise.all([
    import(/* @vite-ignore */ `${base}mcpp.mjs`),
    WebAssembly.compileStreaming(fetch(`${base}mcpp.wasm`)),
    fetch(`${base}headers.json`).then((r) => r.json()),
    import(/* @vite-ignore */ `${base}compcert.js`),
  ]);
  createMcpp = mcppModule.default;
  mcppWasm = wasm;
  headers = hdrs;
  compcert = await compcertReady;
  version = compcert.version;
}

// --- Preprocessing -------------------------------------------------------

const STD_VERSION: Record<string, string> = {
  c99: '199901L',
  c11: '201112L',
  c18: '201710L',
};

// Macros that `gcc -m64 -U__GNUC__ -E` would define for x86_64-linux, plus
// the ones CompCert's driver adds itself (see driver/Frontend.ml).
function predefinedMacros(major: string, minor: string) {
  return [
    '__COMPCERT__',
    `__COMPCERT_MAJOR__=${major}`,
    `__COMPCERT_MINOR__=${minor}`,
    `__COMPCERT_VERSION__=${Number(major) * 100 + Number(minor)}`,
    '__COMPCERT_WCHAR_TYPE__=int',
    '__STDC_HOSTED__=1',
    '__STDC_NO_ATOMICS__', '__STDC_NO_COMPLEX__', '__STDC_NO_THREADS__', '__STDC_NO_VLA__',
    '__x86_64__', '__x86_64', '__amd64__', '__amd64',
    '__linux__', '__linux', '__gnu_linux__', '__unix__', '__unix', '__ELF__',
    '__LP64__', '_LP64', '__CHAR_BIT__=8',
    '__SIZEOF_SHORT__=2', '__SIZEOF_INT__=4', '__SIZEOF_LONG__=8', '__SIZEOF_LONG_LONG__=8',
    '__SIZEOF_POINTER__=8', '__SIZEOF_FLOAT__=4', '__SIZEOF_DOUBLE__=8',
    '__SIZEOF_LONG_DOUBLE__=16', '__SIZEOF_SIZE_T__=8', '__SIZEOF_WCHAR_T__=4',
    '__SIZE_TYPE__=long unsigned int', '__PTRDIFF_TYPE__=long int', '__WCHAR_TYPE__=int',
    '__ORDER_LITTLE_ENDIAN__=1234', '__ORDER_BIG_ENDIAN__=4321',
    '__BYTE_ORDER__=__ORDER_LITTLE_ENDIAN__',
  ].map((m) => `-D${m}`);
}

async function preprocess(filename: string, source: string, args: string[]) {
  let log = '';
  const m = await createMcpp({
    instantiateWasm(
      imports: WebAssembly.Imports,
      done: (i: WebAssembly.Instance, m: WebAssembly.Module) => void,
    ) {
      WebAssembly.instantiate(mcppWasm, imports).then((i) => done(i, mcppWasm));
      return {};
    },
    print: (s: string) => (log += s + '\n'),
    printErr: (s: string) => (log += s + '\n'),
  });
  for (const [path, contents] of Object.entries(headers)) {
    const full = `/usr/include/${path}`;
    m.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
    m.FS.writeFile(full, contents);
  }
  m.FS.mkdirTree('/src');
  m.FS.chdir('/src');
  m.FS.writeFile(filename, source.endsWith('\n') ? source : source + '\n');

  const std = args.findLast((a) => a.startsWith('-std='))?.slice(5) ?? 'c99';
  const [major, minor] = version.split('.');
  const user = args.filter((a) => /^-[DUI]/.test(a));
  const status = m.callMain([
    '-N', // no non-standard predefined macros; we define our own below
    `-V${STD_VERSION[std] ?? STD_VERSION.c99}`,
    ...predefinedMacros(major ?? '3', minor ?? '0'),
    ...user,
    '-I', '/usr/include/compcert',
    '-I', '/usr/include/libc',
    filename, 'out.i',
  ]);
  let output: string | undefined;
  if (status === 0) {
    // CompCert's lexer understands gcc-style "# <n> <file>" line markers.
    output = m.FS.readFile('out.i', { encoding: 'utf8' })
      .replace(/^#line (\d+) "\/src\//gm, '# $1 "')
      .replace(/^#line (\d+)/gm, '# $1');
  }
  return { ok: status === 0, output, log: log.replaceAll('/src/', '') };
}

// --- Diagnostics ---------------------------------------------------------

const DIAG_RE = /^(.+?):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|syntax error)?:?\s*(.*)$/;

function parseDiagnostics(log: string, filename: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  let current: Diagnostic | undefined;
  for (const line of log.split('\n')) {
    const m = DIAG_RE.exec(line);
    if (m && (m[1] === filename || m[1].endsWith(`/${filename}`))) {
      const kind = m[4] ?? '';
      const message = kind === 'syntax error' ? `syntax error ${m[5]}` : m[5];
      current = {
        severity: kind === 'warning' ? 'warning' : kind ? 'error' : 'info',
        line: Number(m[2]),
        column: m[3] ? Number(m[3]) : undefined,
        message,
      };
      out.push(current);
    } else if (m) {
      current = undefined; // a message about another file (e.g. a header)
    } else if (
      current &&
      line.trim() &&
      // mcpp echoes the offending source line, indented; CompCert and mcpp
      // both end with a summary line.
      !/^ {4}/.test(line) &&
      !/^\d+ errors? (detected|in preprocessor)|^Fatal error/.test(line)
    ) {
      current.message += '\n' + line.trim();
    }
  }
  return out;
}

// --- Requests ------------------------------------------------------------

async function compile(req: CompileRequest): Promise<CompileResult> {
  const t0 = performance.now();
  const { filename, source } = req;
  const pre = await preprocess(filename, source, req.args);
  const base = { id: req.id, dumps: {}, ast: {} };
  if (!pre.ok || pre.output === undefined) {
    const log = pre.log || 'preprocessing failed';
    return {
      ...base, ok: false, log,
      diagnostics: parseDiagnostics(log, filename),
      timeMs: performance.now() - t0,
    };
  }

  // Preprocessor options have already been applied.
  const args = req.args.filter((a) => !/^-[DUI]/.test(a));

  stdio = '';
  const r = compcert.compile(filename, pre.output, args);
  const ccLog = stdio + r.diagnostics;

  // The ASTs, as Rocq terms. Errors here duplicate the ones above, except
  // for problems specific to the exporters.
  const ast: CompileResult['ast'] = {};
  let astLog = '';
  for (const mode of ['csyntax', 'clight'] as const) {
    stdio = '';
    const x = compcert.exportRocq(filename, pre.output, args, mode, req.normalize);
    if (x.ok) ast[mode] = x.dumps.rocq;
    else if (!astLog && stdio + x.diagnostics !== ccLog) astLog = stdio + x.diagnostics;
  }

  const log = [pre.log, ccLog, astLog]
    .filter((s) => s.trim())
    .join('\n');
  return {
    ...base,
    ok: r.ok,
    preprocessed: pre.output,
    dumps: r.dumps,
    ast,
    log,
    diagnostics: parseDiagnostics(log, filename),
    timeMs: performance.now() - t0,
  };
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      await init(msg.base);
      post({ type: 'ready', version });
    } catch (err) {
      post({ type: 'init-error', message: String((err as Error)?.message ?? err) });
    }
  } else if (msg.type === 'compile') {
    try {
      post({ type: 'result', ...(await compile(msg.request)) });
    } catch (err) {
      const message = `internal error: ${String((err as Error)?.message ?? err)}`;
      post({
        type: 'result', id: msg.request.id, ok: false, dumps: {}, ast: {},
        log: message, diagnostics: [{ severity: 'error', message }], timeMs: 0,
      });
    }
  }
};
