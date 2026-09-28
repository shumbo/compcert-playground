import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { EXAMPLES } from './examples';
import { normalizeOptions, type Options } from './options';
import { VIEW_BY_ID, type ViewId } from './views';

export type PaneState = {
  view: ViewId;
  rtlPass: number;
  diff: boolean;
  /** Show CompCert C / Clight as Rocq AST terms rather than C syntax. */
  ast: boolean;
};

export type AppState = {
  source: string;
  options: Options;
  panes: PaneState[];
};

const STORAGE_KEY = 'compcert-playground:v1';

export const DEFAULT_PANES: PaneState[] = [{ view: 'asm', rtlPass: 8, diff: false, ast: false }];

function normalize(s: Partial<AppState> | null | undefined): AppState | null {
  if (!s || typeof s.source !== 'string') return null;
  const panes = (Array.isArray(s.panes) ? s.panes : DEFAULT_PANES)
    .filter((p) => p && p.view in VIEW_BY_ID)
    .slice(0, 3)
    .map((p) => ({
      view: p.view,
      rtlPass: Number.isInteger(p.rtlPass) ? Math.min(8, Math.max(0, p.rtlPass)) : 8,
      diff: !!p.diff,
      ast: !!p.ast,
    }));
  return {
    source: s.source,
    options: normalizeOptions(s.options),
    panes: panes.length ? panes : DEFAULT_PANES,
  };
}

export function encodeShare(s: AppState): string {
  return compressToEncodedURIComponent(JSON.stringify(s));
}

function fromHash(): AppState | null {
  const m = /[#&]s=([^&]+)/.exec(location.hash);
  if (!m) return null;
  try {
    return normalize(JSON.parse(decompressFromEncodedURIComponent(m[1]) ?? 'null'));
  } catch {
    return null;
  }
}

function fromStorage(): AppState | null {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

export function loadInitialState(): AppState {
  return (
    fromHash() ??
    fromStorage() ?? {
      source: EXAMPLES[0].source,
      options: normalizeOptions(undefined),
      panes: DEFAULT_PANES,
    }
  );
}

export function saveState(s: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage may be unavailable (private mode, quota); nothing to do
  }
}

export function shareUrl(s: AppState): string {
  const url = new URL(location.href);
  url.hash = `s=${encodeShare(s)}`;
  return url.toString();
}
