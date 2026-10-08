/**
 * Maps ThemeTokens → CSS custom properties on the document root.
 * Called before React renders (via inline script) and when user changes theme.
 */

import type { ThemeTokens } from './palettes';
import { hexToRgb, getTokens, getPalette } from './palettes';
import { contrastRatio } from '@/components/studio/tokens';

function sh(rgb: string, a: number, mult: number): string {
  return `rgba(${rgb},${(a * mult).toFixed(3)})`;
}

/** Apply a token set to the document root (or a specific element). */
export function applyTokens(
  tokens: ThemeTokens,
  el: HTMLElement = document.documentElement,
): void {
  const actionRgb = hexToRgb(tokens.action);
  const riskRgb = hexToRgb(tokens.risk);
  const { sh: shRgb, shA } = tokens;

  // Derived values
  const primaryForeground = readable(tokens.onAction, [tokens.action]);
  const primaryHover = stateFill(tokens.action, primaryForeground, 0.08);
  const primaryPressed = stateFill(tokens.action, primaryForeground, 0.16);
  const surfaces = [tokens.panel, tokens.raised, tokens.sunken, tokens.canvas];
  const secondaryText = readable(tokens.muted, [...surfaces, tokens.bTint, tokens.rTint, tokens.sticky]);
  const riskText = readable(tokens.risk, [...surfaces, tokens.rTint]);
  const branchText = readable(tokens.branch, [...surfaces, tokens.bTint]);
  const actionText = readable(tokens.action, surfaces);
  const destructiveForeground = readable(contrastRatio('#111111', tokens.risk) > contrastRatio('#FFFFFF', tokens.risk) ? '#111111' : '#FFFFFF', [tokens.risk]);
  const destructiveHover = stateFill(tokens.risk, destructiveForeground, 0.08);
  const tintPressed = darkenHex(tokens.aTint, 0.05);
  const accentForeground = readable(tokens.aText, [tokens.aTint, tintPressed]);
  const greenEdgeStrong = darkenHex(tokens.aEdge, 0.12);

  // Note colors: derive dark versions for dark mode, use static Evergreen for light
  const isDark = tokens.isDark;
  const noteYellow = tokens.sticky;
  const noteYellowEdge = isDark ? tokens.stickyInk + '44' : darkenHex(tokens.sticky, 0.10);
  const noteSky = isDark ? '#0D2030' : '#EAF2F8';
  const noteSkyEdge = isDark ? '#1B3A52' : '#C3D7E8';
  const noteMint = isDark ? '#0D2015' : '#E9F4EB';
  const noteMintEdge = isDark ? '#1A4028' : '#BEDAC4';
  const noteRose = isDark ? '#2C1318' : '#F9ECE9';
  const noteRoseEdge = isDark ? '#4D2530' : '#E8C6C0';
  const noteLilac = isDark ? '#1E1528' : '#F1EBF8';
  const noteLilacEdge = isDark ? '#382550' : '#D3C6E6';

  // Warning stays semantic (amber), adjusted for dark
  const warning = isDark ? '#D4900A' : '#A76108';
  const warningText = isDark ? '#C88010' : '#80500D';
  const warningTint = isDark ? '#2A1E06' : '#FFF3DF';
  const warningEdge = isDark ? '#5A3A10' : '#DBC9A9';

  const props: [string, string][] = [
    // ── Shadcn/Radix base tokens ─────────────────────────────────────────────
    ['--background', tokens.raised],
    ['--foreground', tokens.ink],
    ['--card', tokens.panel],
    ['--card-foreground', tokens.ink],
    ['--popover', tokens.raised],
    ['--popover-foreground', tokens.ink],
    ['--primary', tokens.action],
    ['--primary-foreground', primaryForeground],
    ['--secondary', tokens.sunken],
    ['--secondary-foreground', tokens.ink],
    ['--shadcn-muted', tokens.sunken],
    ['--shadcn-muted-foreground', secondaryText],
    ['--accent', tokens.aTint],
    ['--accent-foreground', accentForeground],
    ['--destructive', tokens.risk],
    ['--destructive-foreground', destructiveForeground],
    ['--destructive-hover', destructiveHover],
    ['--border', tokens.l2],
    ['--input', readable(tokens.l4, surfaces, 3)],
    ['--ring', actionText],
    ['--control-border-strong', readable(tokens.l4, surfaces, 3)],

    // ── Evergreen surface roles ──────────────────────────────────────────────
    ['--shell', tokens.shell],
    ['--panel', tokens.panel],
    ['--sunken', tokens.sunken],
    ['--desk', tokens.desk],
    ['--body', tokens.body],
    ['--secondary-text', secondaryText],
    ['--primary-hover', primaryHover],
    ['--primary-pressed', primaryPressed],
    ['--selected-edge', tokens.aEdge],

    // ── Semantic: branch ─────────────────────────────────────────────────────
    ['--branch', tokens.branch],
    ['--branch-solid', readable(tokens.branch, ['#FFFFFF'])],
    ['--branch-foreground', '#FFFFFF'],
    ['--branch-text', branchText],
    ['--branch-tint', tokens.bTint],
    ['--branch-edge', tokens.bEdge],

    // ── Semantic: risk ───────────────────────────────────────────────────────
    ['--risk', tokens.risk],
    ['--risk-text', riskText],
    ['--risk-tint', tokens.rTint],
    ['--risk-edge', tokens.rEdge],

    // ── Semantic: warning ────────────────────────────────────────────────────
    ['--warning', warning],
    ['--warning-text', warningText],
    ['--warning-tint', warningTint],
    ['--warning-edge', warningEdge],

    // ── Interaction states ───────────────────────────────────────────────────
    ['--control-border', tokens.l3],
    ['--hover-border', tokens.l4],
    ['--border-pressed', tokens.l4],
    ['--secondary-hover', tokens.l1],
    ['--secondary-pressed', tokens.l2],
    ['--tint-hover', tokens.aTint],
    ['--tint-hover-edge', tokens.aEdge],
    ['--tint-pressed', tintPressed],

    // ── Note/sticky colors ───────────────────────────────────────────────────
    ['--note', noteYellow],
    ['--note-edge', noteYellowEdge],
    ['--note-sky', noteSky],
    ['--note-sky-edge', noteSkyEdge],
    ['--note-mint', noteMint],
    ['--note-mint-edge', noteMintEdge],
    ['--note-rose', noteRose],
    ['--note-rose-edge', noteRoseEdge],
    ['--note-lilac', noteLilac],
    ['--note-lilac-edge', noteLilacEdge],

    // ── Canvas / grid ────────────────────────────────────────────────────────
    ['--canvas', tokens.canvas],
    ['--grid', tokens.dot],
    ['--canvas-white', tokens.raised],

    // ── Borders ──────────────────────────────────────────────────────────────
    ['--hairline-soft', tokens.l1],
    ['--hairline', tokens.l2],
    ['--border-strong', tokens.l3],

    // ── Text roles ───────────────────────────────────────────────────────────
    ['--text-placeholder', secondaryText],
    ['--text-disabled', tokens.faint],
    ['--text-on-ink', primaryForeground],
    ['--text-on-green', primaryForeground],
    ['--text-primary', tokens.ink],
    ['--text-body', tokens.body],
    ['--text-secondary', secondaryText],
    ['--text-meta', secondaryText],

    // ── Color role aliases ───────────────────────────────────────────────────
    ['--ink', tokens.ink],
    ['--green', tokens.action],
    ['--green-tint', tokens.aTint],
    ['--green-edge', tokens.aEdge],
    ['--green-edge-strong', greenEdgeStrong],
    ['--clay', tokens.risk],
    ['--clay-tint', tokens.rTint],
    ['--clay-edge', tokens.rEdge],
    ['--purple', tokens.branch],
    ['--purple-tint', tokens.bTint],
    ['--purple-edge', tokens.bEdge],

    // ── Ring shadows (direct CSS var, not Tailwind utilities) ────────────────
    ['--ring-soft', `0 0 0 3px rgba(${actionRgb},0.14)`],
    ['--ring-strong', `0 0 0 3px ${actionText}`],
    ['--ring-danger', `0 0 0 3px ${tokens.risk}`],
    ['--ring-danger-soft', `0 0 0 3px rgba(${riskRgb},0.18)`],

    // ── Shadow RGB (used by @theme inline shadow tokens) ─────────────────────
    ['--sh-rgb', shRgb],
    ['--action-rgb', actionRgb],
    ['--risk-rgb', riskRgb],
    ['--brand-mark', tokens.mark],
    ['--action-text', actionText],
    ['--thumbnail-risk', tokens.risk],
    ['--thumbnail-body', tokens.body],
    ['--thumbnail-dot', tokens.dot],
    ['--thumbnail-line', tokens.l4],
    ['--landing-muted', secondaryText],
    ['--landing-muted-light', secondaryText],
    ['--landing-proposal-edge', tokens.bEdge],
    ['--landing-note-fill', tokens.sticky],
    ['--branch-active-fill', tokens.bTint],
    ['--branch-active-edge', tokens.bEdge],
    ['--branch-active-text', branchText],
    ['--branch-hover-fill', tokens.bTint],
    ['--branch-hover-edge', tokens.bEdge],
    ['--note-ink', tokens.stickyInk],
    ['--drafting-frame-edge', tokens.l4],
    ['--drafting-inner-edge', tokens.l2],

    // ── Shadow tokens: theme-aware values override the @theme defaults ────────
    ['--tw-shadow-raised', `0 1px 2px ${sh(shRgb, 0.08, shA)}`],
    ['--tw-shadow-lifted', `0 6px 14px -8px ${sh(shRgb, 0.30, shA)}`],
    ['--tw-shadow-popover', `0 18px 32px -16px ${sh(shRgb, 0.32, shA)}`],
    ['--tw-shadow-floating', `0 20px 44px -18px ${sh(shRgb, 0.38, shA)}, 0 2px 6px ${sh(shRgb, 0.06, shA)}`],
    ['--tw-shadow-frame', `0 24px 48px -20px ${sh(shRgb, 0.24, shA)}`],
    ['--tw-shadow-toast', `0 18px 32px -16px ${sh(shRgb, 0.50, shA)}`],
    ['--tw-shadow-ring-soft', `0 0 0 3px rgba(${actionRgb},0.10)`],
    ['--tw-shadow-ring', `0 0 0 3px rgba(${actionRgb},0.18)`],
    ['--tw-shadow-ring-strong', `0 0 0 3px rgba(${actionRgb},0.28)`],
    ['--tw-shadow-ring-danger', `0 0 0 3px rgba(${riskRgb},0.28)`],
    ['--tw-shadow-ring-danger-soft', `0 0 0 3px rgba(${riskRgb},0.12)`],
  ];

  for (const [prop, val] of props) {
    if (tokens === getTokens('evergreen', 'light')) el.style.removeProperty(prop);
    else el.style.setProperty(prop, val);
  }
  el.style.colorScheme = tokens.isDark ? 'dark' : 'light';
}

/** Preserve palette hue where possible, move only luminance to meet the role. */
function readable(color: string, backgrounds: string[], minimum = 4.5): string {
  if (backgrounds.every(background => contrastRatio(color, background) >= minimum)) return color;
  const targets = ['#000000', '#FFFFFF'].sort((a, b) =>
    Math.min(...backgrounds.map(bg => contrastRatio(b, bg))) - Math.min(...backgrounds.map(bg => contrastRatio(a, bg))));
  for (const target of targets) for (let step = 1; step <= 100; step++) {
    const mixed = mixHex(color, target, step / 100);
    if (backgrounds.every(background => contrastRatio(mixed, background) >= minimum)) return mixed;
  }
  return targets[0];
}

function mixHex(from: string, to: string, amount: number): string {
  return '#' + [1, 3, 5].map(offset => Math.round(parseInt(from.slice(offset, offset + 2), 16) * (1 - amount) + parseInt(to.slice(offset, offset + 2), 16) * amount).toString(16).padStart(2, '0')).join('');
}

function stateFill(fill: string, foreground: string, amount: number): string {
  const proposed = darkenHex(fill, amount);
  return contrastRatio(foreground, proposed) >= 4.5 ? proposed : readable(proposed, [foreground]);
}

/** Simple hex darkening via RGB reduction. */
function darkenHex(hex: string, amount: number): string {
  if (!hex.startsWith('#') || hex.length < 7) return hex;
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - Math.round(amount * 255));
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - Math.round(amount * 255));
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - Math.round(amount * 255));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Serialize a theme selection to a compact string for localStorage.
 * Format: "paletteId:mode"
 */
export function serializeTheme(paletteId: string, mode: 'light' | 'dark'): string {
  return `${paletteId}:${mode}`;
}

/** Parse a stored theme string. Returns null if invalid. */
export function parseTheme(stored: string): { paletteId: string; mode: 'light' | 'dark' } | null {
  const parts = stored.split(':');
  const [id, mode] = parts;
  if (parts.length !== 2 || !getPalette(id) || (mode !== 'light' && mode !== 'dark')) return null;
  return { paletteId: id, mode };
}

export const STORAGE_KEY = 'studio:theme';
