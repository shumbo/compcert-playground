import type { CompileRequest, CompileResult, WorkerMessage } from './protocol';
import CompilerWorker from './compiler.worker?worker';

const TIMEOUT_MS = 30_000;

// Diagnostics options (-W..., -w, -fmax-errors, ...) update state inside
// CompCert that cannot be reset in place, so a change to any of them gets a
// fresh worker.  All other options are reset before every compilation.
const stickyKey = (args: string[]) =>
  args.filter((a) => /^-(W|w$|fmax-errors|fdiagnostics)/.test(a)).join('\u0000');

type Pending = {
  request: CompileRequest;
  resolve: (r: CompileResult | null) => void;
};

export type ClientStatus =
  | { state: 'loading' }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export class CompilerClient {
  private worker!: Worker;
  private ready!: Promise<string>;
  private sticky = '';
  private nextId = 1;
  private inFlight: Pending | null = null;
  private queued: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly base: string;
  private readonly onStatus: (s: ClientStatus) => void;

  constructor(base: string, onStatus: (s: ClientStatus) => void) {
    this.base = base;
    this.onStatus = onStatus;
    this.start();
  }

  private start() {
    this.onStatus({ state: 'loading' });
    this.worker = new CompilerWorker();
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          this.onStatus({ state: 'ready', version: msg.version });
          resolve(msg.version);
        } else if (msg.type === 'init-error') {
          this.onStatus({ state: 'error', message: msg.message });
          reject(new Error(msg.message));
        } else if (msg.type === 'result') {
          this.finish(msg);
        }
      };
      this.worker.onerror = (e) => {
        this.onStatus({ state: 'error', message: e.message || 'worker failed to start' });
        reject(new Error(e.message));
      };
    });
    this.ready.catch(() => {});
    this.worker.postMessage({ type: 'init', base: this.base });
  }

  private restart() {
    this.worker.terminate();
    this.start();
  }

  /** Compile; if a newer request arrives before this one starts, this one
   *  resolves to null. */
  compile(req: Omit<CompileRequest, 'id'>): Promise<CompileResult | null> {
    return new Promise((resolve) => {
      const pending: Pending = { request: { ...req, id: this.nextId++ }, resolve };
      this.queued?.resolve(null);
      this.queued = pending;
      this.pump();
    });
  }

  private async pump() {
    if (this.inFlight || !this.queued) return;
    const job = (this.inFlight = this.queued);
    this.queued = null;

    const key = stickyKey(job.request.args);
    if (key !== this.sticky) {
      this.sticky = key;
      this.restart();
    }
    try {
      await this.ready;
    } catch (err) {
      this.finish(failure(job.request.id, `Could not load the compiler: ${(err as Error).message}`));
      return;
    }
    this.timer = setTimeout(() => {
      this.restart();
      this.finish(failure(job.request.id, `Compilation timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    this.worker.postMessage({ type: 'compile', request: job.request });
  }

  private finish(result: CompileResult) {
    const job = this.inFlight;
    if (!job || job.request.id !== result.id) return;
    clearTimeout(this.timer);
    this.inFlight = null;
    // A crash inside the wasm module may leave it in a bad state.
    if (result.log.startsWith('internal error: ') && !result.ok) this.restart();
    job.resolve(result);
    this.pump();
  }

  dispose() {
    clearTimeout(this.timer);
    this.worker.terminate();
  }
}

function failure(id: number, message: string): CompileResult {
  return {
    id, ok: false, dumps: {}, ast: {}, log: message, timeMs: 0,
    diagnostics: [{ severity: 'error', message }],
  };
}
