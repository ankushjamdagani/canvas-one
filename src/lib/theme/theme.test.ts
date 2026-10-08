import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import {
  PALETTES,
  PALETTE_IDS,
  DEFAULT_PALETTE_ID,
  DEFAULT_MODE,
  getPalette,
  getTokens,
  hexToRgb,
  type ThemeTokens,
} from './palettes';
import { applyTokens, serializeTheme, parseTheme } from './apply';
import { readStoredTheme } from './ThemeContext';
import { contrastRatio } from '@/components/studio/tokens';

afterEach(() => vi.unstubAllGlobals());

const REQUIRED_TOKEN_KEYS: (keyof ThemeTokens)[] = [
  'desk', 'shell', 'canvas', 'panel', 'sunken', 'raised',
  'ink', 'body', 'muted', 'faint',
  'l1', 'l2', 'l3', 'l4', 'dot',
  'branch', 'bTint', 'bEdge',
  'risk', 'rTint', 'rEdge',
  'action', 'onAction', 'aTint', 'aEdge', 'ring',
  'sticky', 'stickyInk',
  'sh', 'isDark',
];

// The supplied design export is kept local (artifacts/ is not published); skip the comparison without it.
const THEMES_SOURCE = 'artifacts/design/System Studio Themes v2.html';

describe('palettes', () => {
  it.skipIf(!existsSync(THEMES_SOURCE))('matches every authored role in all 28 supplied variants', () => {
    const bundled = readFileSync(THEMES_SOURCE, 'utf8');
    const encoded = bundled.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)?.[1];
    expect(encoded).toBeDefined();
    const source: string = JSON.parse(encoded!);
    const context = createContext({});
    runInContext(
      source.slice(source.indexOf('const N_LIGHT'), source.indexOf('let LAYOUTS')) +
      source.slice(source.indexOf('const NATIVE_DARK'), source.indexOf('class Component extends DCLogic')) +
      ';globalThis.palettes=Object.fromEntries(Object.keys(SCHEMES).map(id=>[id,{light:themeFor(id,"light"),dark:themeFor(id,"dark")}]))',
      context,
    );
    for (const palette of PALETTES) for (const mode of ['light', 'dark'] as const) {
      const expected = context.palettes[palette.id][mode];
      for (const [key, value] of Object.entries(expected)) {
        expect(palette[mode][key as keyof ThemeTokens], `${palette.id}:${mode}:${key}`).toEqual(value);
      }
    }
  });
  it('contains exactly 14 schemes', () => {
    expect(PALETTE_IDS.length).toBe(14);
  });

  it('default palette is evergreen', () => {
    expect(DEFAULT_PALETTE_ID).toBe('evergreen');
    expect(DEFAULT_MODE).toBe('light');
  });

  it.each(PALETTE_IDS)('palette %s has all required tokens in both modes', (id) => {
    const lt = getTokens(id, 'light');
    const dk = getTokens(id, 'dark');
    expect(lt).toBeDefined();
    expect(dk).toBeDefined();
    for (const key of REQUIRED_TOKEN_KEYS) {
      expect(lt![key], `light ${id}.${key}`).toBeDefined();
      expect(lt![key], `light ${id}.${key} not empty`).not.toBe('');
      expect(dk![key], `dark ${id}.${key}`).toBeDefined();
      expect(dk![key], `dark ${id}.${key} not empty`).not.toBe('');
    }
  });

  it.each(PALETTE_IDS)('palette %s light isDark=false, dark isDark=true', (id) => {
    expect(getTokens(id, 'light')!.isDark).toBe(false);
    expect(getTokens(id, 'dark')!.isDark).toBe(true);
  });

  it('evergreen light preserves the authored reference palette', () => {
    const t = getTokens('evergreen', 'light')!;
    expect(t.shell).toBe('#FBFAF7');   // warm paper
    expect(t.canvas).toBe('#FFFFFF');
    expect(t.action).toBe('#0B5C54'); // evergreen teal
    expect(t.dot).toBe('#EFEBE3');
  });

  it('evergreen dark has correct accent', () => {
    const t = getTokens('evergreen', 'dark')!;
    expect(t.action).toBe('#5CC2B0');
    expect(t.shell).toBe('#141A18');
  });

  it('action colors are valid hex strings', () => {
    for (const id of PALETTE_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        const action = getTokens(id, mode)!.action;
        expect(action, `${id} ${mode} action`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('getPalette returns undefined for unknown id', () => {
    expect(getPalette('nonexistent')).toBeUndefined();
  });

  it('getPalette returns the correct palette', () => {
    const p = getPalette('slate');
    expect(p?.id).toBe('slate');
    expect(p?.name).toBeTruthy();
    expect(p?.note).toBeTruthy();
  });

  it('all palettes have unique IDs', () => {
    const ids = PALETTES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dark schemes have explicit dark base (not N_DARK gray)', () => {
    // cyanotype, nocturne, saffron have distinct dark shells
    const cyan = getTokens('cyanotype', 'dark')!;
    expect(cyan.shell).not.toBe('#141A18'); // not neutral dark
    const noc = getTokens('nocturne', 'dark')!;
    expect(noc.shell).not.toBe('#141A18');
    const saff = getTokens('saffron', 'dark')!;
    expect(saff.shell).not.toBe('#141A18');
  });
});

describe('hexToRgb', () => {
  it('converts well-known colors', () => {
    expect(hexToRgb('#FFFFFF')).toBe('255,255,255');
    expect(hexToRgb('#000000')).toBe('0,0,0');
    expect(hexToRgb('#0B5C54')).toBe('11,92,84');
  });

  it('handles lowercase hex', () => {
    expect(hexToRgb('#ff0000')).toBe('255,0,0');
  });
});

describe('serializeTheme / parseTheme', () => {
  it('round-trips valid combinations', () => {
    for (const id of PALETTE_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        const s = serializeTheme(id, mode);
        const p = parseTheme(s);
        expect(p?.paletteId).toBe(id);
        expect(p?.mode).toBe(mode);
      }
    }
  });

  it('format is paletteId:mode', () => {
    expect(serializeTheme('evergreen', 'light')).toBe('evergreen:light');
    expect(serializeTheme('nocturne', 'dark')).toBe('nocturne:dark');
  });

  it('parseTheme returns null for invalid inputs', () => {
    expect(parseTheme('')).toBeNull();
    expect(parseTheme('evergreen')).toBeNull();
    expect(parseTheme('evergreen:invalid')).toBeNull();
    expect(parseTheme(':dark')).toBeNull();
    expect(parseTheme('nocturne:dark:extra')).toBeNull();
    expect(parseTheme('unknown:light')).toBeNull();
  });

  it('parseTheme accepts valid mode variants', () => {
    expect(parseTheme('slate:light')?.mode).toBe('light');
    expect(parseTheme('slate:dark')?.mode).toBe('dark');
  });
});

describe('browser preference and role application', () => {
  it.each(PALETTES.flatMap(palette => (['light', 'dark'] as const).map(mode => ({ palette, mode }))))('keeps $palette.id $mode text and state roles readable', ({ palette, mode }) => {
    if (palette.id === 'evergreen' && mode === 'light') return; // CSS-owned defaults verified in browser.
    const props = new Map<string, string>();
    applyTokens(palette[mode], { style: { setProperty: (key: string, value: string) => props.set(key, value) } } as unknown as HTMLElement);
    const pairs = [
      ['--primary-foreground', '--primary'], ['--primary-foreground', '--primary-hover'], ['--primary-foreground', '--primary-pressed'],
      ['--destructive-foreground', '--destructive'], ['--destructive-foreground', '--destructive-hover'],
      ['--accent-foreground', '--accent'], ['--accent-foreground', '--tint-pressed'],
      ['--branch-foreground', '--branch-solid'],
      ['--branch-text', '--branch-tint'], ['--risk-text', '--risk-tint'],
      ...['--background', '--panel', '--sunken', '--canvas'].flatMap(surface => ['--secondary-text', '--action-text', '--branch-text', '--risk-text', '--text-placeholder'].map(text => [text, surface])),
    ];
    for (const [foreground, background] of pairs) expect(contrastRatio(props.get(foreground)!, props.get(background)!), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    for (const surface of ['--background', '--panel', '--sunken', '--canvas']) {
      expect(contrastRatio(props.get('--control-border-strong')!, props.get(surface)!)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(props.get('--ring')!, props.get(surface)!)).toBeGreaterThanOrEqual(3);
    }
  });
  it('uses validated preferences and tolerates blocked reads', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'nocturne:dark' });
    expect(readStoredTheme()).toEqual({ paletteId: 'nocturne', mode: 'dark' });
    vi.stubGlobal('localStorage', { getItem: () => 'nocturne:dark:extra' });
    expect(readStoredTheme()).toEqual({ paletteId: 'evergreen', mode: 'light' });
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Unavailable'); } });
    expect(readStoredTheme()).toEqual({ paletteId: 'evergreen', mode: 'light' });
  });

  it('keeps fluorescent accents readable and restores CSS-owned defaults', () => {
    const props = new Map<string, string>([['--unrelated', 'preserved']]);
    vi.stubGlobal('document', { documentElement: { style: {
      setProperty: (key: string, value: string) => props.set(key, value),
      removeProperty: (key: string) => props.delete(key),
    } } });
    applyTokens(getTokens('achromatic', 'dark')!);
    expect(props.get('--destructive-foreground')).toBe('#111111');
    expect(props.get('--accent-foreground')).toBe('#111111');
    expect(props.get('--action-text')).toBe('#D6F500');
    applyTokens(getTokens('evergreen', 'light')!);
    expect([...props]).toEqual([['--unrelated', 'preserved']]);
  });
});
