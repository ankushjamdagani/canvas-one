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

export function readStoredTheme(): ThemeState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return parseTheme(stored) ?? DEFAULT;
  } catch { /* A theme remains usable when browser storage is unavailable. */ }
  return DEFAULT;
}
export function applyTheme(state: ThemeState): void {
  const palette = getPalette(state.paletteId);
  if (!palette) return;
  applyTokens(palette[state.mode]);
  document.documentElement.dataset.theme = state.paletteId;
  document.documentElement.dataset.themeMode = state.mode;
}
export function initializeTheme(): void { applyTheme(readStoredTheme()); }

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ThemeState>(readStoredTheme);
  const current = React.useRef(state);
  const select = React.useCallback((next: ThemeState) => {
    current.current = next;
    applyTheme(next);
    try { localStorage.setItem(STORAGE_KEY, serializeTheme(next.paletteId, next.mode)); }
    catch { /* Selection still works without storage. */ }
    setState(next);
  }, []);
  const setPaletteId = React.useCallback((id: string) => {
    if (getPalette(id)) select({ ...current.current, paletteId: id });
  }, [select]);
  const setMode = React.useCallback((mode: ThemeMode) => {
    if (mode === 'light' || mode === 'dark') select({ ...current.current, mode });
  }, [select]);
  React.useEffect(() => {
    applyTheme(current.current);
    const handler = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const next = event.newValue === null ? DEFAULT : parseTheme(event.newValue);
      if (!next) return;
      current.current = next;
      applyTheme(next);
      setState(next);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  const api = React.useMemo(() => ({ ...state, setPaletteId, setMode }), [state, setPaletteId, setMode]);
  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}
export function useTheme(): ThemeApi {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
export { PALETTES };
