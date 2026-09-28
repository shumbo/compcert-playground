import type * as Monaco from 'monaco-editor/editor/editor.api';

type M = typeof Monaco;

// GNU assembler syntax, as printed by CompCert's x86 back end.
const gas: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/^\s*[.\w$]+:/, 'type.identifier'],
      [/^\s*\.\w+/, 'annotation', '@operands'],
      [/^\s*[a-z][\w.]*/, 'keyword', '@operands'],
    ],
    operands: [
      [/$/, '', '@pop'],
      [/#.*$/, 'comment', '@pop'],
      [/%\w+/, 'variable.predefined'],
      [/\$-?(0x[0-9a-fA-F]+|\d+)/, 'number'],
      [/-?(0x[0-9a-fA-F]+|\d+)\b/, 'number'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/@\w+/, 'annotation'],
      [/[.\w$]+/, 'identifier'],
    ],
  },
};

// Cminor, RTL, LTL and Mach dumps.
const ir: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  keywords: [
    'var', 'extern', 'readonly', 'volatile', 'if', 'else', 'goto', 'return', 'tailcall',
    'call', 'builtin', 'jumptable', 'switch', 'case', 'default', 'block', 'exit', 'loop',
    'stack', 'nop', 'int8', 'int16', 'int32', 'int64', 'float32', 'float64', 'int8u',
    'int8s', 'int16u', 'int16s', 'int', 'long', 'float', 'single', 'void', 'any32', 'any64',
    'entry', 'branch', 'cond', 'Lgetstack', 'Lsetstack', 'Lop', 'Lload', 'Lstore', 'Lcall',
    'Ltailcall', 'Lbuiltin', 'Llabel', 'Lgoto', 'Lcond', 'Ljumptable', 'Lreturn',
  ],
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/"[^"]*"\s*\(/, { token: 'type.identifier', next: '@root' }],
      [/"[^"]*"/, 'string'],
      [/\b[xX]\d+\b/, 'variable'],
      [/\b(R[A-Z0-9]+|E[A-Z]{2}|X\d+|local\(|outgoing\(|incoming\()/, 'variable.predefined'],
      [/\b[A-Z][A-Z0-9]{1,3}\b/, 'variable.predefined'],
      [/\d+:/, 'type.identifier'],
      [/\b\d+(\.\d+)?[lLfF]?\b/, 'number'],
      [/[a-zA-Z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
    ],
    comment: [
      [/\*\//, 'comment', '@pop'],
      [/./, 'comment'],
    ],
  },
};

const rocq: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  keywords: [
    'Definition', 'Fixpoint', 'Lemma', 'Theorem', 'Proof', 'Qed', 'Defined', 'Require',
    'Import', 'Export', 'From', 'Module', 'End', 'Local', 'Open', 'Scope', 'Global',
    'Instance', 'Existing', 'Let', 'let', 'in', 'fun', 'match', 'with', 'end', 'forall',
    'exists', 'if', 'then', 'else', 'Compute', 'Eval', 'Record', 'Inductive', 'Check',
  ],
  tokenizer: {
    root: [
      [/\(\*/, 'comment', '@comment'],
      [/"([^"]|"")*"/, 'string'],
      [/\b\d+\b/, 'number'],
      [/_[A-Za-z_][\w']*/, 'variable'],
      [/[A-Z][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'type.identifier' } }],
      [/[a-z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/:=|=>|->|::|[{}()[\];,.|]/, 'delimiter'],
    ],
    comment: [
      [/\*\)/, 'comment', '@pop'],
      [/\(\*/, 'comment', '@push'],
      [/./, 'comment'],
    ],
  },
};

export function registerLanguages(monaco: M) {
  for (const [id, def] of [['gas', gas], ['compcert-ir', ir], ['rocq', rocq]] as const) {
    monaco.languages.register({ id });
    monaco.languages.setMonarchTokensProvider(id, def);
  }
  monaco.languages.setLanguageConfiguration('rocq', {
    comments: { blockComment: ['(*', '*)'] },
    brackets: [['(', ')'], ['{', '}'], ['[', ']']],
  });
  monaco.languages.setLanguageConfiguration('compcert-ir', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['(', ')'], ['{', '}'], ['[', ']']],
  });
}
