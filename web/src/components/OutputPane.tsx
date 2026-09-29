import { DiffEditor, Editor } from '@monaco-editor/react';
import { useId, useState } from 'react';
import type { Options } from '../options';
import type { PaneState } from '../state';
import { RTL_PASSES, VIEW_BY_ID, VIEWS, type ViewId } from '../views';
import type { CompileResult, RocqMode } from '../worker/protocol';

type Props = {
  pane: PaneState;
  result: CompileResult | null;
  lastGood: CompileResult | null;
  options: Options;
  theme: string;
  filename: string;
  canClose: boolean;
  canSplit: boolean;
  onChange: (p: PaneState) => void;
  onOptions: (o: Options) => void;
  onClose: () => void;
  onSplit: () => void;
};

const OUTPUT_OPTIONS = {
  readOnly: true,
  domReadOnly: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineNumbersMinChars: 3,
  renderLineHighlight: 'none',
  automaticLayout: true,
  wordWrap: 'off',
  folding: true,
  stickyScroll: { enabled: false },
} as const;

// Views that can be shown either as C syntax or as the Rocq AST.
const AST_MODE: Partial<Record<ViewId, RocqMode>> = { compcert_c: 'csyntax', clight: 'clight' };

function contentOf(
  r: CompileResult | null, view: ViewId, rtlPass: number, ast: boolean, options: Options,
  complete = false,
) {
  if (!r) return undefined;
  // In focus mode the AST is displayed without outside declarations, but
  // copies and downloads always get the complete (compilable) file.
  const asts = !complete && options.focus && r.astFocused ? r.astFocused : r.ast;
  const mode = AST_MODE[view];
  if (ast && mode) return asts[mode];
  switch (view) {
    case 'preprocessed':
      return r.preprocessed;
    case 'rtl':
      return r.dumps[`rtl.${rtlPass}`];
    case 'rocq':
      return asts[options.rocqMode];
    default:
      return r.dumps[view];
  }
}

export function OutputPane(props: Props) {
  const { pane, result, lastGood, options, theme, filename } = props;
  const view = VIEW_BY_ID[pane.view];
  const [copied, setCopied] = useState(false);
  const id = useId();

  const astMode = AST_MODE[pane.view];
  const showAst = pane.view === 'rocq' || (!!astMode && pane.ast);
  const get = (r: CompileResult | null, pass = pane.rtlPass, complete = false) =>
    contentOf(r, pane.view, pass, pane.ast, options, complete);

  let text = get(result);
  let previous = pane.view === 'rtl' && pane.rtlPass > 0 ? get(result, pane.rtlPass - 1) : undefined;
  let stale = false;
  if (text === undefined && result && !result.ok && lastGood) {
    text = get(lastGood);
    previous = pane.view === 'rtl' && pane.rtlPass > 0 ? get(lastGood, pane.rtlPass - 1) : undefined;
    stale = text !== undefined;
  }
  const exported = showAst ? get(stale ? lastGood : result, pane.rtlPass, true) : text;

  const showDiff = pane.view === 'rtl' && pane.diff && pane.rtlPass > 0 && previous !== undefined;
  const pass = RTL_PASSES[pane.rtlPass];
  const passDisabled = pane.view === 'rtl' && pass.flag !== null
    && (!options.optimize || !options.passes[pass.flag as keyof Options['passes']]);

  const copy = async () => {
    if (exported === undefined) return;
    await navigator.clipboard.writeText(exported);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const download = () => {
    if (exported === undefined) return;
    const stem = filename.replace(/\.c$/, '');
    const blob = new Blob([exported], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = pane.view === 'rtl' ? `${stem}.rtl.${pane.rtlPass}`
      : showAst ? `${stem}.v` : `${stem}.${view.ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="pane output-pane">
      <div className="pane-header">
        <select
          className="view-select"
          aria-label="Intermediate representation"
          value={pane.view}
          onChange={(e) => props.onChange({ ...pane, view: e.target.value as ViewId })}
        >
          {VIEWS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <div className="tabs" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={v.id === pane.view}
              className={v.id === pane.view ? 'tab active' : 'tab'}
              title={v.description}
              onClick={() => props.onChange({ ...pane, view: v.id })}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="pane-actions">
          {props.canSplit && (
            <button className="icon-button" title="Add an output pane" onClick={props.onSplit}>
              <SplitIcon />
            </button>
          )}
          {props.canClose && (
            <button className="icon-button" title="Close pane" onClick={props.onClose}>
              ×
            </button>
          )}
        </div>
      </div>

      <div className="toolbar">
        {pane.view === 'rtl' && (
          <>
            <label className="field">
              <span>After</span>
              <select
                value={pane.rtlPass}
                onChange={(e) => props.onChange({ ...pane, rtlPass: Number(e.target.value) })}
              >
                {RTL_PASSES.map((p, i) => (
                  <option key={i} value={i}>
                    {i}. {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="stepper">
              <button
                disabled={pane.rtlPass === 0}
                onClick={() => props.onChange({ ...pane, rtlPass: pane.rtlPass - 1 })}
                title="Previous pass"
              >
                ‹
              </button>
              <button
                disabled={pane.rtlPass === RTL_PASSES.length - 1}
                onClick={() => props.onChange({ ...pane, rtlPass: pane.rtlPass + 1 })}
                title="Next pass"
              >
                ›
              </button>
            </div>
            <label className="check" title="Show changes made by this pass">
              <input
                type="checkbox"
                checked={pane.diff}
                disabled={pane.rtlPass === 0}
                onChange={(e) => props.onChange({ ...pane, diff: e.target.checked })}
              />
              Diff
            </label>
          </>
        )}
        {pane.view === 'rocq' && (
          <>
            <div className="segmented" role="radiogroup" aria-label="AST">
              {(['clight', 'csyntax'] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={options.rocqMode === m}
                  className={options.rocqMode === m ? 'active' : ''}
                  onClick={() => props.onOptions({ ...options, rocqMode: m })}
                >
                  {m === 'clight' ? 'Clight' : 'CompCert C'}
                </button>
              ))}
            </div>
            <label
              className="check"
              title="clightgen -normalize: at most one memory load per expression, none in conditions"
            >
              <input
                type="checkbox"
                checked={options.normalize}
                disabled={options.rocqMode !== 'clight'}
                onChange={(e) => props.onOptions({ ...options, normalize: e.target.checked })}
              />
              -normalize
            </label>
          </>
        )}
        {astMode && (
          <>
            <div className="segmented" role="radiogroup" aria-label="Display">
              {[false, true].map((ast) => (
                <button
                  key={String(ast)}
                  role="radio"
                  aria-checked={pane.ast === ast}
                  className={pane.ast === ast ? 'active' : ''}
                  onClick={() => props.onChange({ ...pane, ast })}
                >
                  {ast ? 'AST' : 'C syntax'}
                </button>
              ))}
            </div>
            {pane.ast && astMode === 'clight' && (
              <label
                className="check"
                title="clightgen -normalize: at most one memory load per expression, none in conditions"
              >
                <input
                  type="checkbox"
                  checked={options.normalize}
                  onChange={(e) => props.onOptions({ ...options, normalize: e.target.checked })}
                />
                -normalize
              </label>
            )}
          </>
        )}
        {pane.view !== 'rtl' && pane.view !== 'rocq' && (
          <span className="toolbar-description">
            {pane.ast && astMode === 'clight'
              ? 'Clight AST as Rocq terms, after local-variable simplification (as clightgen prints it).'
              : pane.ast && astMode
                ? 'CompCert C AST (Csyntax) as Rocq terms, as clightgen -csyntax prints it.'
                : view.description}
          </span>
        )}
        <span className="spacer" />
        <button className="button" onClick={copy} disabled={text === undefined}>
          {copied ? 'Copied!' : showAst ? 'Copy .v' : 'Copy'}
        </button>
        <button className="button" onClick={download} disabled={text === undefined}>
          Download
        </button>
      </div>

      {stale && (
        <div className="banner">Compilation failed — showing the last successful output.</div>
      )}
      {showAst && options.focus && text !== undefined && (
        <div className="banner subtle">
          Declarations from outside your file are hidden. Copy and Download give the complete .v
          file.
        </div>
      )}
      {passDisabled && (
        <div className="banner subtle">
          {pass.name} is disabled by the current options, so this pass leaves the code unchanged.
        </div>
      )}

      <div className="editor-host">
        {text === undefined ? (
          <div className="placeholder">
            {!result ? 'Compiling…' : 'No output: see the errors in the editor pane.'}
          </div>
        ) : showDiff ? (
          <DiffEditor
            // Reuse the same models across updates; letting the wrapper
            // dispose them on unmount races with the diff widget.
            originalModelPath={`inmemory://${id}/original.rtl`}
            modifiedModelPath={`inmemory://${id}/modified.rtl`}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            original={previous}
            modified={text}
            language={view.language}
            theme={theme}
            options={{ ...OUTPUT_OPTIONS, renderSideBySide: false, originalEditable: false }}
          />
        ) : (
          <Editor
            value={text}
            language={showAst ? 'rocq' : view.language}
            theme={theme}
            options={OUTPUT_OPTIONS}
          />
        )}
      </div>
    </section>
  );
}

function SplitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" />
      <line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" />
    </svg>
  );
}
