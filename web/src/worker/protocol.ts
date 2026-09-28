export type RocqMode = 'clight' | 'csyntax';

export type CompileRequest = {
  id: number;
  source: string;
  filename: string;
  /** Extra command-line options, e.g. ["-O0", "-fno-tailcalls", "-DFOO=1"]. */
  args: string[];
  /** clightgen -normalize for the Clight export. */
  normalize: boolean;
};

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  line?: number;
  column?: number;
  message: string;
};

/** Keys of `dumps`: parsed, compcert_c, clight, cminor, rtl.0 … rtl.8, ltl, mach, asm. */
export type Dumps = Record<string, string>;

export type CompileResult = {
  id: number;
  ok: boolean;
  preprocessed?: string;
  dumps: Dumps;
  /** The program as Rocq terms, as clightgen -csyntax / -clight print it. */
  ast: Partial<Record<RocqMode, string>>;
  /** Raw compiler/preprocessor messages, as they would appear in a terminal. */
  log: string;
  diagnostics: Diagnostic[];
  timeMs: number;
};

export type WorkerMessage =
  | { type: 'ready'; version: string }
  | { type: 'init-error'; message: string }
  | ({ type: 'result' } & CompileResult);
