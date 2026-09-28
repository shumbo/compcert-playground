import type { RocqMode } from './worker/protocol';

export const PASS_FLAGS = [
  { flag: 'tailcalls', label: 'Tail calls' },
  { flag: 'inline', label: 'Inlining' },
  { flag: 'inline-functions-called-once', label: 'Inline functions called once' },
  { flag: 'const-prop', label: 'Constant propagation' },
  { flag: 'cse', label: 'Common subexpression elimination' },
  { flag: 'redundancy', label: 'Redundancy elimination' },
  { flag: 'if-conversion', label: 'If-conversion' },
] as const;

export const LANGUAGE_FLAGS = [
  { flag: 'struct-passing', label: 'Pass structs by value' },
  { flag: 'longdouble', label: 'long double as double' },
  { flag: 'packed-structs', label: 'Packed structs' },
  { flag: 'unstructured-switch', label: 'Unstructured switch' },
  { flag: 'inline-asm', label: 'Inline asm' },
] as const;

export type PassFlag = (typeof PASS_FLAGS)[number]['flag'];
export type LanguageFlag = (typeof LANGUAGE_FLAGS)[number]['flag'];

export type Options = {
  optimize: boolean;
  passes: Record<PassFlag, boolean>;
  size: boolean;
  branchless: boolean;
  std: 'c99' | 'c11' | 'c18';
  language: Record<LanguageFlag, boolean>;
  extra: string;
  rocqMode: RocqMode;
  normalize: boolean;
};

export const DEFAULT_OPTIONS: Options = {
  optimize: true,
  passes: Object.fromEntries(PASS_FLAGS.map((p) => [p.flag, true])) as Record<PassFlag, boolean>,
  size: false,
  branchless: false,
  std: 'c99',
  language: Object.fromEntries(LANGUAGE_FLAGS.map((p) => [p.flag, false])) as Record<
    LanguageFlag,
    boolean
  >,
  extra: '',
  rocqMode: 'clight',
  normalize: false,
};

/** Split a command line on whitespace, honouring simple quotes. */
export function splitArgs(s: string): string[] {
  return [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** The ccomp command-line options corresponding to [o]. */
export function toArgs(o: Options): string[] {
  const args: string[] = [];
  if (!o.optimize) args.push('-O0');
  else for (const { flag } of PASS_FLAGS) if (!o.passes[flag]) args.push(`-fno-${flag}`);
  if (o.size) args.push('-Os');
  if (o.branchless) args.push('-Obranchless');
  if (o.std !== 'c99') args.push(`-std=${o.std}`);
  for (const { flag } of LANGUAGE_FLAGS) if (o.language[flag]) args.push(`-f${flag}`);
  return [...args, ...splitArgs(o.extra)];
}

/** Merge possibly partial/stale saved options onto the defaults. */
export function normalizeOptions(o: Partial<Options> | undefined): Options {
  return {
    ...DEFAULT_OPTIONS,
    ...o,
    passes: { ...DEFAULT_OPTIONS.passes, ...o?.passes },
    language: { ...DEFAULT_OPTIONS.language, ...o?.language },
  };
}
