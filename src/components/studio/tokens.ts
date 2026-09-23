/**
 * Evergreen design tokens for System Studio.
 * Single source of truth for the Evergreen paper palette (light-only).
 *
 * Source: specs/revamp/design.md "Tokens (Evergreen paper, light only)"
 * Corrections: specs/revamp/design.md "Accessibility corrections"
 */

export const evergreen = Object.freeze({
  // Surfaces
  canvas: '#FFFFFF',
  shell: '#FBFAF7',
  panel: '#F7F5F1',
  sunken: '#F2EFE9',

  // Text
  ink: '#16201D',
  body: '#4A544F',
  secondary: '#626D68', // Corrected from #6B7671 for WCAG text contrast on panel (4.94:1 >= 4.5:1)

  // Primary action
  primary: '#0B5C54',
  primaryHover: '#0A4E47',
  primaryPressed: '#083F3A',

  // Selection
  selectedTint: '#EAEFEC',
  selectedEdge: '#A8CBC5',

  // Branch & async
  branch: '#7C5FC0',
  branchTint: '#F7F4FC',

  // Risk & alerts
  risk: '#B4674A', // Decorative clay
  riskText: '#A15B40', // Corrected clay for text contrast on riskTint (4.62:1 >= 4.5:1)
  riskTint: '#FBF1EA',
  riskEdge: '#E0C9B6',
  destructive: '#A15B40',
  destructiveHover: '#8E5038',

  // Lines & borders
  divider: '#E7E3DB',
  controlBorder: '#DCD7CD',
  hoverBorder: '#C6C0B4',
  controlBorderStrong: '#948D80', // Darker step of the theme's warm border family; >=3:1 on canvas 3.29, shell 3.15, panel 3.02
  borderPressed: '#B8B1A3',

  // Surfaces (button/ghost pressed step)
  desk: '#E9E7E2',

  // Button secondary interaction steps (sunken fill family)
  secondaryHover: '#EAE6DE',
  secondaryPressed: '#E2DED6',

  // Button/badge tint interaction steps (selected tint family)
  tintHover: '#DFE8E4',
  tintHoverEdge: '#8FBCB4',
  tintPressed: '#D3E0DB',

  // Branch/async tag edge
  branchEdge: '#C9B9E4',

  // Notes
  note: '#FBF6E8',
  noteEdge: '#E6DAB8',

  // Radii
  radii: Object.freeze({
    tag: 4,
    control: 7,
    node: 9,
    popover: 11,
    card: 12,
    dock: 14,
  }),

  // Typography (sizes in px)
  type: Object.freeze({
    xs: 11.5,
    sm: 12.5,
    base: 13,
    lg: 15,
    xl: 18,
    '2xl': 28,
    '3xl': 30,
    '4xl': 36,
    '5xl': 48,
    '6xl': 60,
    '7xl': 72,
    '8xl': 96,
    '9xl': 128,
    display: 46,
    heading: 28,
    title: 18,
    subtitle: 15,
    ui: 13,
  }),

  // Elevation shadows
  // Source: /private/tmp/claude-501/-Users-ankushjamdagani-personal-system-design-planner/578f1a4b-3d34-4104-afe3-18d23c00799f/scratchpad/design.k81I/tokens/shape.css
  shadow: Object.freeze({
    raised: '0 1px 2px rgba(22, 32, 29, 0.08)',
    popover: '0 18px 32px -16px rgba(22, 32, 29, 0.32)',
    floating: '0 20px 44px -18px rgba(22, 32, 29, 0.38), 0 2px 6px rgba(22, 32, 29, 0.06)',
  }),
  shadows: Object.freeze({
    raised: '0 1px 2px rgba(22, 32, 29, 0.08)',
    popover: '0 18px 32px -16px rgba(22, 32, 29, 0.32)',
    floating: '0 20px 44px -18px rgba(22, 32, 29, 0.38), 0 2px 6px rgba(22, 32, 29, 0.06)',
  }),
} as const);

export type Evergreen = typeof evergreen;

/**
 * Calculates the relative luminance of an sRGB color according to WCAG 2.2 specifications.
 * @see https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */
export function relativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, '');
  let r: number;
  let g: number;
  let b: number;

  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16) / 255;
    g = parseInt(clean[1] + clean[1], 16) / 255;
    b = parseInt(clean[2] + clean[2], 16) / 255;
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16) / 255;
    g = parseInt(clean.slice(2, 4), 16) / 255;
    b = parseInt(clean.slice(4, 6), 16) / 255;
  } else {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  const toLinear = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Calculates the WCAG 2.2 contrast ratio between two sRGB hex colors.
 * Returns a ratio between 1 and 21.
 * @see https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}
