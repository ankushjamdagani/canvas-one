type Bezier = [number, number, number, number];

export const EASE: { enter: Bezier; exit: Bezier; inOut: Bezier } = {
  enter: [0.22, 1, 0.36, 1],
  exit: [0.55, 0, 0.75, 0.2],
  inOut: [0.65, 0, 0.35, 1],
};

export type RevealKind = 'content' | 'chrome';
export type RevealPhase = 'enter' | 'exit';

export interface RevealSpec {
  y: number;
  blur: number;
  duration: number;
  delay: number;
}

export interface RevealScopeValue {
  /** Number of `content` reveals on the page; chrome starts after them. */
  contentCount: number;
  /** Seconds the whole page waits before entering (board intro, page shift). */
  baseDelay: number;
}

export interface RevealEnv {
  reduced: boolean;
  off: boolean;
  coarse: boolean;
}

const STAGGER = { content: 0.07, chrome: 0.055, exit: 0.022 } as const;
const REDUCED_DURATION = 0.12;
const OFF_DURATION = 0.001;

export function revealSpec(
  kind: RevealKind,
  phase: RevealPhase,
  index: number,
  scope: RevealScopeValue,
  env: RevealEnv,
): RevealSpec {
  if (env.reduced) return { y: 0, blur: 0, duration: env.off ? OFF_DURATION : REDUCED_DURATION, delay: 0 };
  const blurScale = env.coarse ? 0 : 1;
  if (phase === 'enter') {
    if (kind === 'content') {
      return { y: 18, blur: 8 * blurScale, duration: 0.9, delay: scope.baseDelay + index * STAGGER.content };
    }
    return {
      y: -10,
      blur: 4 * blurScale,
      duration: 0.7,
      delay: scope.baseDelay + scope.contentCount * STAGGER.content + 0.26 + index * STAGGER.chrome,
    };
  }
  return kind === 'content'
    ? { y: -16, blur: 6 * blurScale, duration: 0.42, delay: index * STAGGER.exit }
    : { y: -8, blur: 3 * blurScale, duration: 0.42, delay: index * STAGGER.exit };
}

/** Persistent drafting board. Seconds unless noted. */
export const BOARD = {
  dotsIntro: 1.3,
  dotsScale: 1.06,
  frameIntro: 1,
  frameDelay: 0.45,
  ringDelay: 1.15,
  ringDuration: 0.7,
  pageDelay: 1.4,
  shiftPx: 24,
  shiftDuration: 1.1,
  shiftDelay: 0.22,
  fadeOut: 0.7,
} as const;

/** Card-to-canvas overlay. Seconds. */
export const CARD = {
  growDuration: 0.76,
  growDelay: 0.12,
  fadeDuration: 0.7,
  cancelDuration: 0.5,
  /** Workspace enter starts this long after the overlay starts fading. */
  enterGap: 0.16,
  /** The overlay never holds longer than this waiting for the workspace. */
  readyTimeout: 3,
} as const;

/** Project canvas choreography. Seconds unless noted. */
export const CANVAS = {
  nodeDuration: 0.8,
  nodeStagger: 0.11,
  nodeStaggerBudget: 1.2,
  maxBlurNodes: 12,
  edgeDelay: 0.26,
  edgeDuration: 0.75,
  barGap: 0.52,
  barOffset: 28,
  barDuration: 0.85,
  exitBar: 0.42,
  exitNode: 0.38,
  exitNodeDelay: 0.1,
  exitNodeStagger: 0.025,
} as const;
