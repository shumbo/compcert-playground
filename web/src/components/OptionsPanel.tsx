import { useEffect, useRef } from 'react';
import { DEFAULT_OPTIONS, LANGUAGE_FLAGS, PASS_FLAGS, type Options } from '../options';

type Props = {
  options: Options;
  onChange: (o: Options) => void;
  onClose: () => void;
};

export function OptionsPanel({ options, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest('[data-options-toggle]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const set = (patch: Partial<Options>) => onChange({ ...options, ...patch });

  return (
    <div className="options-panel" ref={ref} role="dialog" aria-label="Compiler options">
      <fieldset>
        <legend>Optimization</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={options.optimize}
            onChange={(e) => set({ optimize: e.target.checked })}
          />
          Optimize <code>{options.optimize ? '-O' : '-O0'}</code>
        </label>
        <div className="indent">
          {PASS_FLAGS.map(({ flag, label }) => (
            <label className="check" key={flag}>
              <input
                type="checkbox"
                disabled={!options.optimize}
                checked={options.optimize && options.passes[flag]}
                onChange={(e) =>
                  set({ passes: { ...options.passes, [flag]: e.target.checked } })
                }
              />
              {label} <code>-f{flag}</code>
            </label>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={options.size}
            onChange={(e) => set({ size: e.target.checked })}
          />
          Optimize for size <code>-Os</code>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={options.branchless}
            onChange={(e) => set({ branchless: e.target.checked })}
          />
          Prefer branch-free code <code>-Obranchless</code>
        </label>
      </fieldset>

      <fieldset>
        <legend>Language</legend>
        <label className="field">
          <span>Standard</span>
          <select
            value={options.std}
            onChange={(e) => set({ std: e.target.value as Options['std'] })}
          >
            <option value="c99">C99</option>
            <option value="c11">C11</option>
            <option value="c18">C18</option>
          </select>
        </label>
        {LANGUAGE_FLAGS.map(({ flag, label }) => (
          <label className="check" key={flag}>
            <input
              type="checkbox"
              checked={options.language[flag]}
              onChange={(e) =>
                set({ language: { ...options.language, [flag]: e.target.checked } })
              }
            />
            {label} <code>-f{flag}</code>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Extra options</legend>
        <input
          className="text-input"
          type="text"
          spellCheck={false}
          placeholder="-DNDEBUG -Wall -ffloat-const-prop 0"
          value={options.extra}
          onChange={(e) => set({ extra: e.target.value })}
        />
        <p className="hint">
          Preprocessor options (<code>-D</code>, <code>-U</code>, <code>-I</code>) go to mcpp; the
          rest go to CompCert.
        </p>
      </fieldset>

      <div className="options-footer">
        <button
          className="button"
          onClick={() =>
            onChange({
              ...DEFAULT_OPTIONS,
              rocqMode: options.rocqMode,
              normalize: options.normalize,
              focus: options.focus,
            })
          }
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
