import * as React from 'react';
import { PALETTES, DEFAULT_PALETTE_ID, DEFAULT_MODE, getPalette, type ThemeMode } from './palettes';
import { applyTokens, serializeTheme, parseTheme, STORAGE_KEY } from './apply';
export interface ThemeState { paletteId: string; mode: ThemeMode }
export interface ThemeApi extends ThemeState {
  setPaletteId: (id: string) => void;
  setMode: (mode: ThemeMode) => void;
}
const ThemeContext = React.createContext<ThemeApi | null>(null);
const DEFAULT: ThemeState = { paletteId: DEFAULT_PALETTE_ID, mode: DEFAULT_MODE };
let activeThemeRoot: HTMLElement | null = null;

/** Imperative canvas effects share the mounted workspace's token root. */
export function getThemeRoot(): HTMLElement {
  return activeThemeRoot ?? document.querySelector<HTMLElement>('.canvas-one-root') ?? document.documentElement;
}

export function themeStorageKey(storageNamespace?: string): string {
  return storageNamespace ? `${storageNamespace}:${STORAGE_KEY}` : STORAGE_KEY;
}

export function readStoredTheme(storageNamespace?: string): ThemeState {
  try {
    const stored = localStorage.getItem(themeStorageKey(storageNamespace));
    if (stored) return parseTheme(stored) ?? DEFAULT;
  } catch { /* A theme remains usable when browser storage is unavailable. */ }
  return DEFAULT;
}
export function applyTheme(state: ThemeState, target: HTMLElement = getThemeRoot()): void {
  const palette = getPalette(state.paletteId);
  if (!palette) return;
  applyTokens(palette[state.mode], target);
  target.dataset.theme = state.paletteId;
  target.dataset.themeMode = state.mode;
}
export function initializeTheme(): void { applyTheme(readStoredTheme()); }

export function ThemeProvider({ children, target, storageNamespace }: {
  children: React.ReactNode;
  target?: React.RefObject<HTMLElement | null>;
  storageNamespace?: string;
}) {
  // Both server render and first client render use the same markup.
  const [state, setState] = React.useState<ThemeState>(DEFAULT);
  const current = React.useRef(state);
  const storageKey = themeStorageKey(storageNamespace);
  const select = React.useCallback((next: ThemeState) => {
    current.current = next;
    applyTheme(next, target?.current ?? document.documentElement);
    try { localStorage.setItem(storageKey, serializeTheme(next.paletteId, next.mode)); }
    catch { /* Selection still works without storage. */ }
    setState(next);
  }, [storageKey, target]);
  const setPaletteId = React.useCallback((id: string) => {
    if (getPalette(id)) select({ ...current.current, paletteId: id });
  }, [select]);
  const setMode = React.useCallback((mode: ThemeMode) => {
    if (mode === 'light' || mode === 'dark') select({ ...current.current, mode });
  }, [select]);
  React.useEffect(() => {
    const root = target?.current ?? document.documentElement;
    activeThemeRoot = root;
    const initial = readStoredTheme(storageNamespace);
    current.current = initial;
    applyTheme(initial, root);
    setState(initial);
    const handler = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const next = event.newValue === null ? DEFAULT : parseTheme(event.newValue);
      if (!next) return;
      current.current = next;
      applyTheme(next, root);
      setState(next);
    };
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('storage', handler);
      if (activeThemeRoot === root) activeThemeRoot = null;
    };
  }, [storageKey, storageNamespace, target]);
  const api = React.useMemo(() => ({ ...state, setPaletteId, setMode }), [state, setPaletteId, setMode]);
  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}
export function useTheme(): ThemeApi {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
export { PALETTES };
