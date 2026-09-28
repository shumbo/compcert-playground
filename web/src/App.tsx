import { Editor, type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OptionsPanel } from './components/OptionsPanel';
import { OutputPane } from './components/OutputPane';
import { EXAMPLES } from './examples';
import { monaco } from './monaco';
import { toArgs, type Options } from './options';
import { loadInitialState, saveState, shareUrl, type AppState, type PaneState } from './state';
import { CompilerClient, type ClientStatus } from './worker/client';
import type { CompileResult, Diagnostic } from './worker/protocol';

const FILENAME = 'example.c';
const COMPCERT_RELEASE = 'v3.18';
const MAX_PANES = 3;

type Editor = Parameters<OnMount>[0];

function useColorScheme() {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark ? 'vs-dark' : 'vs';
}

export default function App() {
  const initial = useMemo(loadInitialState, []);
  const [source, setSource] = useState(initial.source);
  const [options, setOptions] = useState<Options>(initial.options);
  const [panes, setPanes] = useState<PaneState[]>(initial.panes);
  const [status, setStatus] = useState<ClientStatus>({ state: 'loading' });
  const [result, setResult] = useState<CompileResult | null>(null);
  const [lastGood, setLastGood] = useState<CompileResult | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [shared, setShared] = useState(false);
  const [split, setSplit] = useState(42);
  const clientRef = useRef<CompilerClient | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const theme = useColorScheme();

  const args = useMemo(() => toArgs(options), [options]);
  const argsKey = args.join('\u0000');

  useEffect(() => {
    const base = new URL(`${import.meta.env.BASE_URL}compcert/`, document.baseURI).href;
    const client = new CompilerClient(base, setStatus);
    clientRef.current = client;
    return () => client.dispose();
  }, []);

  // Recompile (debounced) whenever the source or the options change.
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    setCompiling(true);
    const t = setTimeout(async () => {
      const r = await client.compile({
        source,
        filename: FILENAME,
        args,
        normalize: options.normalize,
      });
      if (!r) return; // superseded by a newer request
      setResult(r);
      if (r.ok) setLastGood(r);
      setCompiling(false);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, argsKey, options.normalize]);

  // Persist the session.
  useEffect(() => {
    const t = setTimeout(() => saveState({ source, options, panes }), 300);
    return () => clearTimeout(t);
  }, [source, options, panes]);

  // Error markers in the source editor.
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    const markers = (result?.diagnostics ?? [])
      .filter((d) => d.line !== undefined)
      .map((d) => {
        const line = Math.min(d.line!, model.getLineCount());
        const col = d.column ?? model.getLineFirstNonWhitespaceColumn(line) ?? 1;
        return {
          severity:
            d.severity === 'error'
              ? monaco.MarkerSeverity.Error
              : d.severity === 'warning'
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
          message: d.message,
          startLineNumber: line,
          startColumn: Math.max(1, col),
          endLineNumber: line,
          endColumn: model.getLineMaxColumn(line),
        };
      });
    monaco.editor.setModelMarkers(model, 'compcert', markers);
  }, [result]);

  const reveal = (d: Diagnostic) => {
    const ed = editorRef.current;
    if (!ed || d.line === undefined) return;
    ed.revealLineInCenter(d.line);
    ed.setPosition({ lineNumber: d.line, column: d.column ?? 1 });
    ed.focus();
  };

  const updatePane = (i: number, p: PaneState) =>
    setPanes((ps) => ps.map((q, j) => (j === i ? p : q)));
  const closePane = (i: number) => setPanes((ps) => ps.filter((_, j) => j !== i));
  const splitPane = (i: number) =>
    setPanes((ps) =>
      ps.length >= MAX_PANES
        ? ps
        : [...ps.slice(0, i + 1), { ...ps[i], view: ps[i].view === 'asm' ? 'rtl' : 'asm' }, ...ps.slice(i + 1)],
    );

  const share = async () => {
    const state: AppState = { source, options, panes };
    const url = shareUrl(state);
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch {
      // clipboard not available; the URL is still in the address bar
    }
  };

  const onDragStart = useCallback((e: React.PointerEvent) => {
    const main = mainRef.current;
    if (!main) return;
    e.preventDefault();
    const rect = main.getBoundingClientRect();
    const vertical = getComputedStyle(main).flexDirection === 'column';
    const move = (ev: PointerEvent) => {
      const pct = vertical
        ? ((ev.clientY - rect.top) / rect.height) * 100
        : ((ev.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.min(80, Math.max(15, pct)));
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging');
    };
    document.body.classList.add('dragging');
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }, []);

  const diagnostics = result?.diagnostics ?? [];
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  const unlocated = result && !result.ok && diagnostics.every((d) => d.line === undefined);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ⟨cc⟩
          </span>
          <h1>CompCert Playground</h1>
        </div>
        <select
          className="examples"
          aria-label="Load an example"
          value=""
          onChange={(e) => {
            const ex = EXAMPLES[Number(e.target.value)];
            if (ex) setSource(ex.source);
          }}
        >
          <option value="" disabled>
            Examples…
          </option>
          {EXAMPLES.map((ex, i) => (
            <option key={i} value={i}>
              {ex.name}
            </option>
          ))}
        </select>
        <div className="options-anchor">
          <button
            className={showOptions ? 'button active' : 'button'}
            data-options-toggle
            onClick={() => setShowOptions((s) => !s)}
            aria-expanded={showOptions}
          >
            Options
          </button>
          {showOptions && (
            <OptionsPanel
              options={options}
              onChange={setOptions}
              onClose={() => setShowOptions(false)}
            />
          )}
        </div>
        <code className="cmdline" title="Equivalent command line">
          ccomp {args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}
          {args.length ? ' ' : ''}-S {FILENAME}
        </code>
        <span className="spacer" />
        <StatusBadge status={status} compiling={compiling} result={result} />
        <button className="button primary" onClick={share}>
          {shared ? 'Link copied!' : 'Share'}
        </button>
      </header>

      <main className="workspace" ref={mainRef}>
        <section className="pane source-pane" style={{ flexBasis: `${split}%` }}>
          <div className="pane-header">
            <span className="filename">{FILENAME}</span>
            <span className="target">
              CompCert {COMPCERT_RELEASE} · x86_64-linux
            </span>
          </div>
          <div className="editor-host">
            <Editor
              defaultLanguage="c"
              value={source}
              theme={theme}
              onChange={(v) => setSource(v ?? '')}
              onMount={(ed) => {
                editorRef.current = ed;
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                lineNumbersMinChars: 3,
              }}
            />
          </div>
          <div className={`problems ${errors ? 'has-errors' : ''}`}>
            <div className="problems-header">
              {errors || warnings ? (
                <>
                  {errors > 0 && <span className="count error">{errors} error{errors > 1 ? 's' : ''}</span>}
                  {warnings > 0 && (
                    <span className="count warning">
                      {warnings} warning{warnings > 1 ? 's' : ''}
                    </span>
                  )}
                </>
              ) : result && !result.ok ? (
                <span className="count error">Compilation failed</span>
              ) : (
                <span className="muted">No problems</span>
              )}
            </div>
            {diagnostics.some((d) => d.line !== undefined) && (
              <ul className="problem-list">
                {diagnostics
                  .filter((d) => d.line !== undefined)
                  .map((d, i) => (
                    <li key={i}>
                      <button className={`problem ${d.severity}`} onClick={() => reveal(d)}>
                        <span className="loc">
                          {d.line}
                          {d.column ? `:${d.column}` : ''}
                        </span>
                        <span className="msg">{d.message}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            {result?.log.trim() && (
              <details className="log" open={!!unlocated} key={result.id}>
                <summary>Compiler output</summary>
                <pre>{result.log.trim()}</pre>
              </details>
            )}
          </div>
        </section>

        <div
          className="resizer"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onDragStart}
        />

        <div className="outputs" style={{ flexBasis: `${100 - split}%` }}>
          {panes.map((p, i) => (
            <OutputPane
              key={i}
              pane={p}
              result={result}
              lastGood={lastGood}
              options={options}
              theme={theme}
              filename={FILENAME}
              canClose={panes.length > 1}
              canSplit={panes.length < MAX_PANES}
              onChange={(np) => updatePane(i, np)}
              onOptions={setOptions}
              onClose={() => closePane(i)}
              onSplit={() => splitPane(i)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

function StatusBadge({
  status,
  compiling,
  result,
}: {
  status: ClientStatus;
  compiling: boolean;
  result: CompileResult | null;
}) {
  if (status.state === 'loading') return <span className="status loading">Loading compiler…</span>;
  if (status.state === 'error')
    return (
      <span className="status error" title={status.message}>
        Compiler failed to load
      </span>
    );
  if (compiling) return <span className="status loading">Compiling…</span>;
  if (!result) return null;
  return result.ok ? (
    <span className="status ok">Compiled in {Math.round(result.timeMs)} ms</span>
  ) : (
    <span className="status error">Compilation failed</span>
  );
}
