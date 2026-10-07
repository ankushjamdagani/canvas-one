# Route Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the "System Studio Transitions" showcase to the real app: a persistent drafting board with an intro, choreographed page enter/exit on `/`, `/projects` and the project canvas, a card-to-canvas expansion when opening a project, and the new Project Canvas header (logo + back button).

**Architecture:** A new `RouteShell` owns one persistent board layer (animated ground + double frame) and renders pages inside `AnimatePresence mode="wait"` keyed by route kind. Pages declare motion with a small `Reveal` primitive (two kinds: `content`, `chrome`); the project canvas (ReactFlow nodes, edges, bars) is animated imperatively by one hook because ReactFlow owns node `transform`. A `CardOverlay` clip-path grow bridges `/projects` to the canvas and waits for the session to open. Motion is switched off in e2e via a `localStorage` flag.

**Tech Stack:** React 19, Motion 14 (`motion/react`, `LazyMotion` + `domAnimation`), Vite 8, Vitest 5 (`src/**/*.test.ts` only), Playwright (production suite), Storybook.

## Global Constraints

- Easings: `ENTER = cubic-bezier(0.22,1,0.36,1)`, `EXIT = cubic-bezier(0.55,0,0.75,0.2)`, `INOUT = cubic-bezier(0.65,0,0.35,1)`; all motion tokens live in `src/lib/motion/tokens.ts`, no inline curves elsewhere.
- Library is `motion` (MIT), React entry `motion/react`, `LazyMotion` + `domAnimation`; no router library; `src/lib/router.ts` stays.
- Intro plays on every full load of `/` and `/projects`; a deep link to `/project/...` skips the intro and plays only the canvas enter.
- Reduced motion: opacity-only fades ≤ 120 ms, no blur/translate, no clip-path overlay, no board intro.
- No chunk over 500 kB in `npm run build` (LESSONS). Do not use `React.lazy`/Suspense on user-facing paths (LESSONS); `AnimatePresence` is not Suspense.
- Unit tests must be `src/**/*.test.ts`; render components with `React.createElement` + `renderToStaticMarkup` (LESSONS).
- E2E screenshots/files go to `test.info().outputPath(...)` (LESSONS). Before calling UI work done: `npm run build`, then the full production browser suite on an isolated port with a throwaway repo-local Playwright config, `TEST_PRODUCTION=1`, 2 workers, no retries, `reuseExistingServer: false` (LESSONS).
- Foundation-first: shared UI goes in `src/components/ui/`, tokens in `src/styles.css`; verify with `npm run build-storybook`.
- Element-level CSS defaults go in `@layer base`; the one unlayered rule in Task 6 is an attribute-scoped override on purpose.
- Typecheck with `npx tsc -b` only; never pass `--noEmit false` (LESSONS).
- Use `rtk` prefix for output-heavy commands where available (e.g. `rtk npm run build`).
- Product is not live: no compatibility shims for old page-owned backgrounds.

## Spec deviations decided during planning (also appended to the spec in Task 8)

1. Motion is disabled in e2e through `localStorage['studio:motion'] === 'off'` (set by Playwright `storageState`), not a `window` global; a global `reducedMotion: 'reduce'` would change the landing demo behaviour that existing tests rely on.
2. The Workspace keeps its own frame, `p-[23px]` and static dots; the shell board fades out under the card overlay instead of being reused (removes the highest-risk part of the spec, the Workspace height model).
3. Canvas edges fade in (container opacity) instead of drawing along `pathLength`; `TrafficEdge` renders multi-layer lanes, so per-path drawing would touch the traffic renderer.
4. Reveal kinds reduce to `content` and `chrome`; node/edge/bar choreography lives in `canvasTransition.ts`.
5. The navigation queue is `AnimatePresence`'s own last-wins behaviour for rapid route changes; no custom queue.
6. Board frame intro is a clip-path sweep of the existing frame, not four separately drawn lines.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/motion/tokens.ts` | Easing tuples, board/card/canvas constants, `revealSpec()` pure timing function |
| `src/lib/motion/direction.ts` | `PageKind`, `pageDirection(from,to)` |
| `src/lib/motion/env.ts` | `motionOff()`, `useMotionEnv()` (reduced/off/coarse) |
| `src/lib/motion/MotionProvider.tsx` | `LazyMotion` + `MotionConfig` wrapper mounted in `main.tsx` |
| `src/lib/motion/shell-context.ts` | `RouteShellApi`, `RouteShellContext`, `useRouteShell()`, `ShellReady` |
| `src/components/ui/reveal.tsx` | `Reveal`, `RevealScope` (the only Motion surface in feature code) |
| `src/components/ui/brand-mark.tsx` | Shared gradient logo square |
| `src/components/ui/drafting-board.tsx` / `drafting-sheet.tsx` | Skip own ground/frame when inside the shell |
| `src/features/shell/overlayGeometry.ts` | Pure clip-path inset math |
| `src/features/shell/BoardLayer.tsx` | Persistent ground + frame, intro and page-shift animations |
| `src/features/shell/CardOverlay.tsx` | Grow / hold / fade / cancel overlay |
| `src/features/shell/RouteShell.tsx` | Page swapping, direction, overlay state machine, context provider |
| `src/features/workspace/canvasTransition.ts` | Imperative canvas enter/exit (nodes, edges, bars) |
| `src/features/workspace/useCanvasTransition.ts` | Hook wiring that into `Workspace` + `usePresence` |
| `src/features/workspace/TopBar.tsx` | New leading cluster (logo, back button) |
| `tests/route-transitions.spec.ts` | Real-speed e2e for transitions |

---

### Task 1: Motion dependency, tokens, direction, environment

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Create: `src/lib/motion/tokens.ts`, `src/lib/motion/direction.ts`, `src/lib/motion/env.ts`
- Test: `src/lib/motion/tokens.test.ts`, `src/lib/motion/direction.test.ts`

**Interfaces:**
- Produces:
  - `EASE: { enter, exit, inOut }` each `[number, number, number, number]`
  - `type RevealKind = 'content' | 'chrome'`, `type RevealPhase = 'enter' | 'exit'`
  - `interface RevealSpec { y: number; blur: number; duration: number; delay: number }`
  - `interface RevealScopeValue { contentCount: number; baseDelay: number }`
  - `interface RevealEnv { reduced: boolean; off: boolean; coarse: boolean }`
  - `revealSpec(kind, phase, index, scope, env): RevealSpec`
  - `BOARD`, `CARD`, `CANVAS` constant objects (fields below)
  - `type PageKind = 'home' | 'projects' | 'project'`; `pageDirection(from: PageKind, to: PageKind): -1 | 0 | 1`
  - `motionOff(): boolean`; `useMotionEnv(): RevealEnv`

- [ ] **Step 1: Install Motion**

Run: `npm install motion`
Expected: `package.json` gains `"motion": "^14.0.0"`; no peer warnings (React 19).

- [ ] **Step 2: Write the failing tests**

`src/lib/motion/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BOARD, EASE, revealSpec } from './tokens';

const scope = { contentCount: 3, baseDelay: 0 };
const full = { reduced: false, off: false, coarse: false };

describe('motion tokens', () => {
  it('keeps the showcase easings', () => {
    expect(EASE.enter).toEqual([0.22, 1, 0.36, 1]);
    expect(EASE.exit).toEqual([0.55, 0, 0.75, 0.2]);
    expect(EASE.inOut).toEqual([0.65, 0, 0.35, 1]);
  });

  it('staggers content by 70 ms and rises 18 px with 8 px blur', () => {
    const s = revealSpec('content', 'enter', 2, scope, full);
    expect(s).toMatchObject({ y: 18, blur: 8, duration: 0.9 });
    expect(s.delay).toBeCloseTo(0.14, 5);
  });

  it('starts chrome after all content: contentCount*70 + 260 ms, then 55 ms apart', () => {
    const s = revealSpec('chrome', 'enter', 1, scope, full);
    expect(s).toMatchObject({ y: -10, blur: 4, duration: 0.7 });
    expect(s.delay).toBeCloseTo(3 * 0.07 + 0.26 + 0.055, 5);
  });

  it('adds the shell base delay to enters but not exits', () => {
    const base = { contentCount: 1, baseDelay: 1.4 };
    expect(revealSpec('content', 'enter', 0, base, full).delay).toBeCloseTo(1.4, 5);
    expect(revealSpec('content', 'exit', 0, base, full)).toMatchObject({ y: -16, blur: 6, duration: 0.42, delay: 0 });
    expect(revealSpec('chrome', 'exit', 2, base, full).delay).toBeCloseTo(0.044, 5);
  });

  it('drops blur on coarse pointers', () => {
    expect(revealSpec('content', 'enter', 0, scope, { ...full, coarse: true }).blur).toBe(0);
  });

  it('collapses to a short opacity fade when reduced, and to ~zero when off', () => {
    expect(revealSpec('content', 'enter', 4, scope, { ...full, reduced: true })).toEqual({ y: 0, blur: 0, duration: 0.12, delay: 0 });
    expect(revealSpec('chrome', 'exit', 4, scope, { reduced: true, off: true, coarse: false })).toEqual({ y: 0, blur: 0, duration: 0.001, delay: 0 });
  });

  it('exposes the board intro timeline', () => {
    expect(BOARD).toMatchObject({ dotsIntro: 1.3, frameIntro: 1, frameDelay: 0.45, pageDelay: 1.4, shiftPx: 24, shiftDuration: 1.1, shiftDelay: 0.22 });
  });
});
```

`src/lib/motion/direction.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pageDirection } from './direction';

describe('pageDirection', () => {
  it.each([
    ['home', 'projects', 1],
    ['projects', 'project', 1],
    ['home', 'project', 1],
    ['projects', 'home', -1],
    ['project', 'projects', -1],
    ['project', 'home', -1],
    ['projects', 'projects', 0],
  ] as const)('%s -> %s is %i', (from, to, expected) => {
    expect(pageDirection(from, to)).toBe(expected);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/motion`
Expected: FAIL, "Failed to resolve import './tokens'" / "'./direction'".

- [ ] **Step 4: Implement**

`src/lib/motion/tokens.ts`:

```ts
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
```

`src/lib/motion/direction.ts`:

```ts
export type PageKind = 'home' | 'projects' | 'project';

const ORDER: Record<PageKind, number> = { home: 0, projects: 1, project: 2 };

/** +1 when moving deeper into the app, -1 when moving back out. */
export function pageDirection(from: PageKind, to: PageKind): -1 | 0 | 1 {
  return Math.sign(ORDER[to] - ORDER[from]) as -1 | 0 | 1;
}
```

`src/lib/motion/env.ts`:

```ts
import * as React from 'react';
import { useReducedMotion } from 'motion/react';
import type { RevealEnv } from './tokens';

const STORAGE_KEY = 'studio:motion';

/** E2E and debugging switch: `localStorage['studio:motion'] = 'off'` makes motion near-instant. */
export function motionOff(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'off';
  } catch {
    return false;
  }
}

export function useMotionEnv(): RevealEnv {
  const prefersReduced = useReducedMotion() ?? false;
  return React.useMemo(() => {
    const off = motionOff();
    const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
    return { reduced: prefersReduced || off, off, coarse };
  }, [prefersReduced]);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/motion`
Expected: PASS (2 files).

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc -b`
Expected: no output.

```bash
git add package.json package-lock.json src/lib/motion
git commit -m "feat(motion): add motion dependency, tokens, direction and env helpers"
```

---

### Task 2: Provider, Playwright motion-off flag, Reveal

**Files:**
- Create: `src/lib/motion/MotionProvider.tsx`, `src/components/ui/reveal.tsx`, `src/stories/ui/Reveal.stories.tsx`
- Modify: `src/main.tsx`, `playwright.config.ts`
- Test: `src/components/ui/reveal.test.ts`

**Interfaces:**
- Consumes: `revealSpec`, `EASE`, `RevealKind`, `RevealScopeValue`, `useMotionEnv` (Task 1)
- Produces:
  - `<MotionProvider>{children}</MotionProvider>`
  - `<RevealScope contentCount?: number baseDelay?: number>` (omitted fields inherit from parent scope)
  - `<Reveal as?: 'div'|'span'|'section'|'header'|'nav'|'a'|'article'|'main'|'footer' kind?: RevealKind index?: number ...htmlProps>`
  - `revealVariants` (exported for tests)

- [ ] **Step 1: Write the failing test**

`src/components/ui/reveal.test.ts`:

```ts
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Reveal, RevealScope, revealVariants } from './reveal';

const spec = (y: number, blur: number, duration: number, delay: number) => ({ y, blur, duration, delay });
const custom = { enter: spec(18, 8, 0.9, 0.14), exit: spec(-16, 6, 0.42, 0) };

describe('Reveal', () => {
  it('renders the requested element with its props and no inline hidden style outside a page', () => {
    const html = renderToStaticMarkup(
      React.createElement(Reveal, { as: 'span', className: 'x', 'data-testid': 't' } as never, 'hi'),
    );
    expect(html).toBe('<span class="x" data-testid="t">hi</span>');
  });

  it('inherits unspecified scope fields', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RevealScope,
        { contentCount: 2, baseDelay: 1 },
        React.createElement(RevealScope, { contentCount: 5 }, React.createElement(Reveal, { kind: 'chrome' }, 'a')),
      ),
    );
    expect(html).toContain('a');
  });

  it('hidden/enter/exit variants resolve the spec', () => {
    expect(revealVariants.hidden(custom)).toEqual({ opacity: 0, y: 18, filter: 'blur(8px)' });
    expect(revealVariants.enter(custom)).toMatchObject({
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0.9, delay: 0.14 },
    });
    expect(revealVariants.exit(custom)).toMatchObject({
      opacity: 0,
      y: -16,
      filter: 'blur(6px)',
      transition: { duration: 0.42, delay: 0 },
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/ui/reveal.test.ts`
Expected: FAIL, "Failed to resolve import './reveal'".

- [ ] **Step 3: Implement**

`src/components/ui/reveal.tsx`:

```tsx
import * as React from 'react';
import { m } from 'motion/react';
import { useMotionEnv } from '@/lib/motion/env';
import {
  EASE,
  revealSpec,
  type RevealKind,
  type RevealScopeValue,
  type RevealSpec,
} from '@/lib/motion/tokens';

const ScopeContext = React.createContext<RevealScopeValue>({ contentCount: 0, baseDelay: 0 });

/** Page-level context for stagger counts and the page's start delay. Omitted fields inherit. */
export function RevealScope({
  contentCount,
  baseDelay,
  children,
}: {
  contentCount?: number;
  baseDelay?: number;
  children: React.ReactNode;
}) {
  const parent = React.useContext(ScopeContext);
  const value = React.useMemo(
    () => ({ contentCount: contentCount ?? parent.contentCount, baseDelay: baseDelay ?? parent.baseDelay }),
    [contentCount, baseDelay, parent.contentCount, parent.baseDelay],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

interface Custom {
  enter: RevealSpec;
  exit: RevealSpec;
}
const blur = (px: number) => `blur(${px}px)`;

/** Variant names match the page frame in `RouteShell`, which drives them through `animate`/`exit`. */
export const revealVariants = {
  hidden: (c: Custom) => ({ opacity: 0, y: c.enter.y, filter: blur(c.enter.blur) }),
  enter: (c: Custom) => ({
    opacity: 1,
    y: 0,
    filter: blur(0),
    transition: { duration: c.enter.duration, delay: c.enter.delay, ease: EASE.enter },
  }),
  exit: (c: Custom) => ({
    opacity: 0,
    y: c.exit.y,
    filter: blur(c.exit.blur),
    transition: { duration: c.exit.duration, delay: c.exit.delay, ease: EASE.exit },
  }),
};

const TAGS = {
  div: m.div,
  span: m.span,
  section: m.section,
  header: m.header,
  nav: m.nav,
  a: m.a,
  article: m.article,
  main: m.main,
  footer: m.footer,
} as const;
export type RevealTag = keyof typeof TAGS;

type HtmlProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'style'
>;
export type RevealProps = HtmlProps & {
  as?: RevealTag;
  kind?: RevealKind;
  /** Position among siblings of the same kind (drives the stagger). */
  index?: number;
  style?: React.CSSProperties;
  href?: string;
};

/**
 * Animates in and out with its page. Outside a shell page it renders as a plain element.
 * `filter` is cleared after entering so a finished reveal creates no stacking context.
 */
export function Reveal({ as = 'div', kind = 'content', index = 0, children, ...rest }: RevealProps) {
  const scope = React.useContext(ScopeContext);
  const env = useMotionEnv();
  const custom = React.useMemo<Custom>(
    () => ({
      enter: revealSpec(kind, 'enter', index, scope, env),
      exit: revealSpec(kind, 'exit', index, scope, env),
    }),
    [kind, index, scope, env],
  );
  const ref = React.useRef<HTMLElement | null>(null);
  const Tag = TAGS[as] as React.ElementType;
  return (
    <Tag
      {...rest}
      ref={ref}
      variants={revealVariants}
      custom={custom}
      onAnimationComplete={(definition: unknown) => {
        if (definition === 'enter' && ref.current) ref.current.style.filter = 'none';
      }}
    >
      {children}
    </Tag>
  );
}
```

Reveal must add no attributes of its own: the test expects exactly `<span class="x" data-testid="t">hi</span>`.

`src/lib/motion/MotionProvider.tsx`:

```tsx
import * as React from 'react';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';

/** One feature bundle (`domAnimation`) for the whole app; `m` components only (`strict`). */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
```

`src/main.tsx`: wrap `<App />`:

```tsx
import { MotionProvider } from './lib/motion/MotionProvider';
// ...
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionProvider>
      <App />
    </MotionProvider>
  </React.StrictMode>,
);
```

`playwright.config.ts`: add `storageState` to `use` so every test starts with motion off (the dedicated spec in Task 8 overrides it):

```ts
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1512, height: 982 },
    storageState: {
      cookies: [],
      origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: "studio:motion", value: "off" }] }],
    },
  },
```

`src/stories/ui/Reveal.stories.tsx`:

```tsx
import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { m } from "motion/react";
import { MotionProvider } from "@/lib/motion/MotionProvider";
import { Reveal, RevealScope } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";

function Demo() {
  const [n, setN] = React.useState(0);
  return (
    <MotionProvider>
      <Button onClick={() => setN((v) => v + 1)}>Replay</Button>
      <m.div
        key={n}
        initial="hidden"
        animate="enter"
        variants={{ hidden: {}, enter: {}, exit: {} }}
        className="mt-6 flex flex-col gap-3"
      >
        <RevealScope contentCount={2}>
          <Reveal kind="chrome" className="text-micro text-secondary-text">Chrome rises after content</Reveal>
          <Reveal kind="content" index={0} className="font-display text-4xl">Content line one</Reveal>
          <Reveal kind="content" index={1} className="font-display text-4xl italic">Content line two</Reveal>
        </RevealScope>
      </m.div>
    </MotionProvider>
  );
}

const meta = { title: "UI/Reveal", component: Demo, parameters: { layout: "padded" } } satisfies Meta<typeof Demo>;
export default meta;
export const Playground: StoryObj<typeof meta> = {};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/components/ui/reveal.test.ts && npx tsc -b`
Expected: PASS, no type errors. If the `Tag` element-type cast leaves a TS error on `variants`/`custom`, keep the `React.ElementType` cast; do not weaken other types.

- [ ] **Step 5: Verify the e2e flag does not break the suite start**

Run: `TEST_PRODUCTION=1 npx playwright test tests/studio-entry.spec.ts --workers=1`
Expected: same pass/fail as before the config change (motion code is not yet wired; this proves `storageState` is valid). Record the result.

- [ ] **Step 6: Commit**

```bash
git add src/lib/motion src/components/ui/reveal.tsx src/components/ui/reveal.test.ts src/stories/ui/Reveal.stories.tsx src/main.tsx playwright.config.ts
git commit -m "feat(motion): provider, Reveal primitive and e2e motion-off flag"
```

---

### Task 3: BrandMark and the Project Canvas header

**Files:**
- Create: `src/components/ui/brand-mark.tsx`, `src/stories/ui/BrandMark.stories.tsx`
- Modify: `src/features/workspace/TopBar.tsx:216-266` (leading cluster), `src/components/ui/drafting-sheet.tsx:25-35` (use `BrandMark`)
- Modify tests: `tests/studio-linked-projects.spec.ts:116`, `tests/studio-project-canvas.spec.ts:10`
- Test: `src/components/ui/brand-mark.test.ts`

**Interfaces:**
- Produces: `<BrandMark className? />` (decorative `span`, `aria-hidden`); TopBar test ids `brand` (the logo, non-interactive) and `topbar-back` (button, `aria-label="All projects"`, calls `onAllProjects`)

- [ ] **Step 1: Failing test**

`src/components/ui/brand-mark.test.ts`:

```ts
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  it('is a decorative gradient square', () => {
    const html = renderToStaticMarkup(React.createElement(BrandMark, { className: 'size-5' }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('size-5');
    expect(html).toContain('to-[#2e7d6b]');
  });
});
```

Run: `npx vitest run src/components/ui/brand-mark.test.ts` → FAIL (missing module).

- [ ] **Step 2: Implement BrandMark**

`src/components/ui/brand-mark.tsx`:

```tsx
import { cn } from "@/lib/utils";

/** System Studio logo square. Decorative: pair it with visible text or a labelled control. */
export function BrandMark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={cn("inline-block size-5 shrink-0 rounded-[5px] bg-linear-to-br from-primary to-[#2e7d6b]", className)}
    />
  );
}
```

In `src/components/ui/drafting-sheet.tsx` replace the brand `<span aria-hidden ... />` inside the `<a href="/">` with `<BrandMark />` and import it (`import { BrandMark } from "./brand-mark";`).

Run the test again → PASS.

- [ ] **Step 3: Update TopBar leading cluster**

In `src/features/workspace/TopBar.tsx`, replace everything from `{/* Brand mark */}` through the closing of the version `<span data-testid="topbar-version" ...>` (the `<button data-testid="brand">…</button>` and the version span) with:

```tsx
        {/* Logo (static) and the way back to the project list */}
        <BrandMark
          data-testid="brand"
          className="max-sm:hidden"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="topbar-back"
          aria-label="All projects"
          title="All projects"
          onClick={onAllProjects}
          className="h-8 shrink-0 gap-1.5 px-2 text-[13px] font-medium text-secondary-text hover:text-ink"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          <span className="hidden sm:inline">Projects</span>
        </Button>
```

Keep the existing vertical divider `<div className="hidden sm:block w-px h-[22px] ...">` after it. Add imports `import { ArrowLeft } from "lucide-react";` (merge with the existing lucide import if present), `import { BrandMark } from "@/components/ui/brand-mark";`, and `Button` if not already imported. Remove the `APP_VERSION_LABEL` import and the now-unused `brand-mark-gradient` SVG if nothing else uses them.

- [ ] **Step 4: Update e2e selectors**

`tests/studio-linked-projects.spec.ts:115-116`: change to

```ts
  // The back button goes to the project list.
  await page.getByTestId('topbar-back').click();
```

`tests/studio-project-canvas.spec.ts:10`: replace the `topbar-version` assertion with

```ts
    await expect(page.getByTestId('topbar-version')).toHaveCount(0);
    await expect(page.getByTestId('brand')).toBeVisible();
    await expect(page.getByTestId('topbar-back')).toBeVisible();
```

- [ ] **Step 5: Story**

`src/stories/ui/BrandMark.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandMark } from "@/components/ui/brand-mark";

const meta = { title: "UI/Brand mark", component: BrandMark } satisfies Meta<typeof BrandMark>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
export const Large: StoryObj<typeof meta> = { args: { className: "size-10 rounded-[10px]" } };
```

- [ ] **Step 6: Verify**

Run: `npx tsc -b && npx vitest run src/components/ui src/features/workspace`
Expected: PASS. Then `npm run build-storybook` → success.
Run: `TEST_PRODUCTION=1 npx playwright test tests/studio-project-canvas.spec.ts tests/studio-linked-projects.spec.ts --workers=1` after `npm run build`.
Expected: PASS. Take a 1440×900 screenshot of an open project (`page.screenshot({ path: test.info().outputPath('header.png') })`) and confirm the header reads logo, `← Projects`, divider, title.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui src/features/workspace/TopBar.tsx src/stories/ui/BrandMark.stories.tsx tests/studio-linked-projects.spec.ts tests/studio-project-canvas.spec.ts
git commit -m "feat(workspace): logo and back-to-projects header"
```

---

### Task 4: Shell context, persistent board, RouteShell (no page reveals yet)

**Files:**
- Create: `src/lib/motion/shell-context.ts`, `src/features/shell/BoardLayer.tsx`, `src/features/shell/RouteShell.tsx`, `src/features/shell/index.ts`
- Modify: `src/components/ui/drafting-board.tsx`, `src/components/ui/drafting-board.css`, `src/components/ui/drafting-sheet.tsx`, `src/App.tsx`
- Test: `src/lib/motion/shell-context.test.ts`

**Interfaces:**
- Produces (`shell-context.ts`):
  ```ts
  export interface RouteShellApi {
    /** Starts the card→canvas overlay from `el`; no-op under reduced motion. */
    beginOpen(el: HTMLElement): void;
    /** Reverses the overlay after a failed open. */
    cancelOpen(): void;
    /** The workspace (or an error page) is on screen; the overlay may fade. */
    markReady(): void;
    setGroundPaused(paused: boolean): void;
  }
  export const RouteShellContext: React.Context<RouteShellApi | null>;
  export function useRouteShell(): RouteShellApi | null;
  export function ShellReady(): null; // calls markReady once on mount
  ```
- Produces: `<RouteShell renderPage={(kind: PageKind) => ReactNode} />`
- Board test ids: `route-board` (root, with `data-intro="true|false"`), page wrapper `data-page-kind`.

- [ ] **Step 1: Failing test for ShellReady/useRouteShell**

`src/lib/motion/shell-context.test.ts`:

```ts
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RouteShellContext, ShellReady, useRouteShell, type RouteShellApi } from './shell-context';

function Probe() {
  return React.createElement('i', null, useRouteShell() ? 'in' : 'out');
}

describe('route shell context', () => {
  it('is null outside a shell', () => {
    expect(renderToStaticMarkup(React.createElement(Probe))).toBe('<i>out</i>');
  });

  it('exposes the api inside a shell', () => {
    const api: RouteShellApi = { beginOpen() {}, cancelOpen() {}, markReady() {}, setGroundPaused() {} };
    const html = renderToStaticMarkup(
      React.createElement(RouteShellContext.Provider, { value: api }, React.createElement(Probe), React.createElement(ShellReady)),
    );
    expect(html).toBe('<i>in</i>');
  });
});
```

Run: `npx vitest run src/lib/motion/shell-context.test.ts` → FAIL (missing module).

- [ ] **Step 2: Implement context**

`src/lib/motion/shell-context.ts`:

```ts
import * as React from 'react';

export interface RouteShellApi {
  beginOpen(el: HTMLElement): void;
  cancelOpen(): void;
  markReady(): void;
  setGroundPaused(paused: boolean): void;
}

export const RouteShellContext = React.createContext<RouteShellApi | null>(null);

/** `null` when rendered outside the shell (Storybook, unit tests). */
export function useRouteShell(): RouteShellApi | null {
  return React.useContext(RouteShellContext);
}

/** Render on pages that never animate a canvas in (errors) so an overlay can leave. */
export function ShellReady(): null {
  const shell = useRouteShell();
  React.useEffect(() => {
    shell?.markReady();
  }, [shell]);
  return null;
}
```

Run the test → PASS.

- [ ] **Step 3: Make DraftingBoard/DraftingSheet shell-aware**

`src/components/ui/drafting-board.tsx`:

- Add imports: `import { cn } from "@/lib/utils"; import { useRouteShell } from "@/lib/motion/shell-context";`
- `DraftingGround` gains a prop `pointerSource?: "board" | "document"` (default `"board"`). In its effect, replace `board.addEventListener("pointermove", move); board.addEventListener("pointerleave", leave);` with:

```ts
    const source: HTMLElement = pointerSource === "document" ? document.documentElement : board;
    source.addEventListener("pointermove", move);
    source.addEventListener("pointerleave", leave);
```

  and the matching `removeEventListener` calls in the cleanup use `source`. Add `pointerSource` to the effect's dependency list.
- `DraftingBoard` becomes:

```tsx
export function DraftingBoard({ children, paused = false }: { children: React.ReactNode; paused?: boolean }) {
  const shell = useRouteShell();
  const setGroundPaused = shell?.setGroundPaused;
  React.useEffect(() => {
    if (!setGroundPaused) return;
    setGroundPaused(paused);
    return () => setGroundPaused(false);
  }, [paused, setGroundPaused]);
  const [size, setSize] = React.useState({ w: innerWidth, h: innerHeight });
  React.useEffect(() => {
    const resize = () => setSize({ w: innerWidth, h: innerHeight });
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, []);
  const scale = Math.min(1, size.w / 1440, size.h / 900);
  return (
    <div
      className={cn("drafting-board", shell && "drafting-board--in-shell")}
      style={{ "--board-scale": scale } as React.CSSProperties}
    >
      {!shell && (
        <>
          <DraftingGround paused={paused} />
          <DraftingFrame />
        </>
      )}
      {children}
    </div>
  );
}
```

`src/components/ui/drafting-board.css` append:

```css
/* The route shell paints the shared ground and frame behind every page. */
.drafting-board--in-shell {
  background: transparent;
}
```

`src/components/ui/drafting-sheet.tsx`: use the context in `DraftingSheet`:

```tsx
  const shell = useRouteShell();
  ...
    <div
      data-page={page}
      className={cn(
        "relative isolate flex min-h-svh flex-col px-6 pt-6 pb-11 font-sans text-ink min-[481px]:px-10 min-[481px]:pt-9 min-[481px]:pb-[76px] min-[1101px]:px-14",
        shell ? "bg-transparent" : "bg-shell",
      )}
    >
      {!shell && (
        <>
          <DraftingGround />
          <DraftingFrame />
        </>
      )}
```

(import `useRouteShell` from `@/lib/motion/shell-context`).

- [ ] **Step 4: BoardLayer**

`src/features/shell/BoardLayer.tsx`:

```tsx
import * as React from 'react';
import { animate } from 'motion/react';
import { DraftingFrame, DraftingGround } from '@/components/ui/drafting-board';
import { cn } from '@/lib/utils';
import { useMotionEnv } from '@/lib/motion/env';
import { BOARD, EASE } from '@/lib/motion/tokens';

export interface BoardShift {
  dir: -1 | 0 | 1;
  /** Increments on every page change so the same direction can replay. */
  n: number;
}

/**
 * Ground (dots) and double frame behind every page. Mounted once by `RouteShell`, so the
 * board survives page swaps; it fades out on the project canvas, which paints its own sheet.
 */
export function BoardLayer({
  visible,
  intro,
  shift,
  paused,
}: {
  visible: boolean;
  /** Decided once at first mount: play the load intro. */
  intro: boolean;
  shift: BoardShift;
  paused: boolean;
}) {
  const env = useMotionEnv();
  const playIntro = intro && !env.reduced;
  const dots = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!playIntro) return;
    const d = dots.current!;
    const f = frame.current!;
    const controls = [
      animate(d, { opacity: [0, 1], scale: [BOARD.dotsScale, 1] }, { duration: BOARD.dotsIntro, ease: EASE.enter }),
      animate(
        f,
        { opacity: [0, 1], clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'] },
        { duration: BOARD.frameIntro, delay: BOARD.frameDelay, ease: EASE.inOut },
      ),
    ];
    void controls[1].then(() => {
      f.style.clipPath = '';
    });
    return () => controls.forEach((c) => c.stop());
  }, [playIntro]);

  React.useEffect(() => {
    if (!shift.n || env.reduced) return;
    const d = dots.current!;
    const f = frame.current!;
    const controls = [
      animate(
        d,
        { y: [0, 0, -BOARD.shiftPx * shift.dir], opacity: [1, 0.35, 1] },
        { duration: BOARD.shiftDuration, ease: EASE.inOut, times: [0, 0.45, 1] },
      ),
      animate(f, { opacity: [1, 0.25, 1] }, { duration: BOARD.shiftDuration, ease: EASE.inOut, times: [0, 0.45, 1] }),
    ];
    // The grid repeats every 24 px, so snapping back is invisible.
    void controls[0].then(() => {
      d.style.transform = '';
    });
    return () => controls.forEach((c) => c.stop());
  }, [shift.n, shift.dir, env.reduced]);

  return (
    <div
      data-testid="route-board"
      data-intro={String(playIntro)}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 z-0 transition-opacity',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ transitionDuration: `${BOARD.fadeOut}s` }}
    >
      <div ref={dots} className="absolute inset-0" style={{ opacity: playIntro ? 0 : 1 }}>
        <DraftingGround paused={paused || !visible} pointerSource="document" />
      </div>
      <div ref={frame} className="absolute inset-0" style={{ opacity: playIntro ? 0 : 1 }}>
        <DraftingFrame />
      </div>
    </div>
  );
}
```

Note `data-intro` reflects the decision `intro && !reduced`; deep links and reduced motion read `"false"`.

- [ ] **Step 5: RouteShell (page swap, direction; overlay arrives in Task 7)**

`src/features/shell/RouteShell.tsx`:

```tsx
import * as React from 'react';
import { AnimatePresence, m } from 'motion/react';
import { RevealScope } from '@/components/ui/reveal';
import { useRoute } from '@/lib/router';
import { pageDirection, type PageKind } from '@/lib/motion/direction';
import { useMotionEnv } from '@/lib/motion/env';
import { RouteShellContext, type RouteShellApi } from '@/lib/motion/shell-context';
import { BOARD } from '@/lib/motion/tokens';
import { BoardLayer, type BoardShift } from './BoardLayer';

const PAGE_VARIANTS = { hidden: {}, enter: {}, exit: {} };

interface Page {
  kind: PageKind;
  /** Seconds the page waits before its reveals start. */
  baseDelay: number;
}

export function RouteShell({ renderPage }: { renderPage: (kind: PageKind) => React.ReactNode }) {
  const env = useMotionEnv();
  const { route } = useRoute();
  const target: PageKind = route.kind;

  const intro = React.useRef(target !== 'project').current;
  const [page, setPage] = React.useState<Page>(() => ({
    kind: target,
    baseDelay: intro && !env.reduced ? BOARD.pageDelay : 0,
  }));
  const [shift, setShift] = React.useState<BoardShift>({ dir: 0, n: 0 });
  const [groundPaused, setGroundPaused] = React.useState(false);
  const [phase, setPhase] = React.useState<'enter' | 'exit'>('enter');

  React.useEffect(() => {
    if (target === page.kind) return;
    setShift((s) => ({ dir: pageDirection(page.kind, target) || 1, n: s.n + 1 }));
    setPage({ kind: target, baseDelay: BOARD.shiftDelay });
    setPhase('enter');
  }, [target, page.kind]);

  const api = React.useMemo<RouteShellApi>(
    () => ({
      beginOpen() {},
      cancelOpen() {},
      markReady() {},
      setGroundPaused,
    }),
    [],
  );

  return (
    <RouteShellContext.Provider value={api}>
      <div className="relative isolate min-h-svh bg-shell">
        <BoardLayer visible={page.kind !== 'project'} intro={intro} shift={shift} paused={groundPaused} />
        <AnimatePresence mode="wait">
          <m.div
            key={page.kind}
            data-page-kind={page.kind}
            className="relative z-10"
            variants={PAGE_VARIANTS}
            initial="hidden"
            animate={phase}
            exit="exit"
          >
            <RevealScope baseDelay={page.baseDelay}>{renderPage(page.kind)}</RevealScope>
          </m.div>
        </AnimatePresence>
      </div>
    </RouteShellContext.Provider>
  );
}
```

`src/features/shell/index.ts`: `export { RouteShell } from './RouteShell';`

- [ ] **Step 6: Wire `App.tsx`**

In `StudioShell`'s render section (current lines ~230-277) replace the `if (route.kind === 'project') {…}` chain, the `home` return and the final `EntryScreen` return with a `renderPage` passed to the shell. Keep all hooks and effects above unchanged.

```tsx
  const renderPage = (kind: PageKind): React.ReactNode => {
    if (kind === 'home') return <LandingPage />;
    if (kind === 'projects') {
      return (
        <EntryScreen session={session} repository={repository} mintId={MINT_ID} actor={actor} onOpenSuccess={goToProject} />
      );
    }
    if (route.kind !== 'project') return null;
    if (sessionState.projectId === route.projectId) {
      return (
        <Workspace
          session={session}
          repository={repository}
          onBackToProjects={() => navigate({ kind: 'projects' })}
          mintId={MINT_ID}
          actor={actor}
        />
      );
    }
    if (openError?.projectId === route.projectId) {
      return (
        <div
          data-testid="project-route-error"
          className="min-h-screen w-full flex flex-col items-center justify-center gap-3 bg-shell text-ink p-6 text-center"
        >
          <ShellReady />
          <h1 className="text-lg font-bold">Project unavailable</h1>
          <p className="text-xs text-secondary-text max-w-md">{openError.message}</p>
          <Button size="sm" onClick={() => navigate({ kind: 'projects' })}>
            All projects
          </Button>
        </div>
      );
    }
    return (
      <div
        data-testid="workspace-loading-screen"
        className="min-h-screen w-full flex items-center justify-center bg-shell text-xs text-secondary-text"
      >
        Opening project…
      </div>
    );
  };

  return <RouteShell renderPage={renderPage} />;
```

Add imports: `import { RouteShell } from './features/shell';`, `import type { PageKind } from '@/lib/motion/direction';`, `import { ShellReady } from '@/lib/motion/shell-context';`. The hooks must remain above the `return`; `renderPage` is a plain closure.

- [ ] **Step 7: Verify**

Run: `npx tsc -b && npx vitest run`
Expected: PASS.
Run: `npm run build`, then `TEST_PRODUCTION=1 npx playwright test tests/studio-landing.spec.ts tests/studio-entry.spec.ts tests/studio-design-language.spec.ts --workers=2`
Expected: PASS (motion off via storage flag). If the landing pointer-crosshair or frame-geometry assertions fail, inspect `route-board` placement before changing the tests.

- [ ] **Step 7: Focus and inert (accessibility)**

In `RouteShell.tsx` add a child component rendered as the first child of the page frame:

```tsx
function PageA11y() {
  const [isPresent] = usePresence();
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const frame = ref.current?.parentElement;
    if (!frame) return;
    // Leaving content must not take focus or be read while it animates away.
    frame.inert = !isPresent;
  }, [isPresent]);
  return <span ref={ref} hidden />;
}
```

(import `usePresence` from `motion/react`). On the frame `m.div` add `onAnimationComplete`: after the `enter` variant finishes, if `document.activeElement` is `document.body` (nothing focused, so a keyboard user mid-task is never stolen from) move focus to the page heading without scrolling:

```tsx
onAnimationComplete={(def) => {
  if (def !== 'enter' || document.activeElement !== document.body) return;
  document.querySelector<HTMLElement>(`[data-page-kind="${page.kind}"] h1`)?.focus({ preventScroll: true });
}}
```

Give the headings a programmatic focus target: add `tabIndex={-1}` and `className` `outline-none` to `DraftingHeading`'s `h1` in `drafting-sheet.tsx` and to the landing `<h1>` in `LandingPage.tsx`. The workspace needs no heading focus (the canvas owns focus).

Run: `npx tsc -b && npx vitest run`, then rebuild and re-run `TEST_PRODUCTION=1 npx playwright test tests/studio-landing.spec.ts tests/studio-entry.spec.ts --workers=2` (axe checks in those specs must still pass). Real-speed keyboard probe in the browser pane: after `/` -> Try Beta, `document.activeElement` is the Projects `h1` once the enter finishes; tab order starts at the header brand link; with a button focused before a transition focus is not moved.

- [ ] **Step 8: Commit**

```bash
git add src/lib/motion src/features/shell src/components/ui src/App.tsx
git commit -m "feat(shell): persistent board layer and route shell"
```

---

### Task 5: Reveal the Landing and Projects pages

**Files:**
- Modify: `src/features/entry/LandingPage.tsx:227-677`, `src/features/entry/EntryScreen.tsx` (heading, tiles, projects section), `src/components/ui/drafting-sheet.tsx` (header items)

**Interfaces:**
- Consumes: `Reveal`, `RevealScope` (Task 2); shell page frame from Task 4.

- [ ] **Step 1: Drafting sheet header (chrome)**

In `src/components/ui/drafting-sheet.tsx` import `{ Reveal, RevealScope } from "./reveal"` and wrap the header contents (chrome index order: brand, version, nav):

```tsx
      <header className="flex h-10 flex-none items-center gap-3">
        <Reveal as="a" kind="chrome" index={0} href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm text-sm font-semibold text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          <BrandMark />
          System Studio
        </Reveal>
        <Reveal as="span" kind="chrome" index={1} className="font-mono text-micro tracking-normal text-secondary-text max-[480px]:hidden">
          v0.4.12
        </Reveal>
        <Reveal as="nav" kind="chrome" index={2} aria-label="Main navigation" className="ml-auto flex items-center gap-2 min-[481px]:gap-4">
          {navigation}
        </Reveal>
      </header>
```

(`Reveal` forwards `className`, `href` and aria attributes; keep the existing class strings exactly.)

- [ ] **Step 2: Projects content**

In `EntryScreen.tsx` wrap the three page groups; set the scope count to 3:

```tsx
      <DraftingSheet page="Projects" navigation={...}>
        <RevealScope contentCount={3}>
          <DraftingMain>
            <div className="flex flex-col gap-5">
              <Reveal kind="content" index={0}>
                <DraftingHeading>Start a project <em>or pick up a sheet.</em></DraftingHeading>
              </Reveal>
              {errorMessage && (/* unchanged */)}
              <Reveal as="section" kind="content" index={1} aria-label="Start a project" className="grid grid-cols-1 gap-4 min-[801px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-h-44 [&>*]:min-w-0 [&>*]:rounded-xl">
                {/* the three tiles, unchanged */}
              </Reveal>
            </div>
            <Reveal as="section" kind="content" index={2} aria-labelledby="existing-projects-heading" className="flex flex-1 flex-col">
              {/* unchanged contents */}
            </Reveal>
          </DraftingMain>
        </RevealScope>
      </DraftingSheet>
```

Imports: `import { Reveal, RevealScope } from "@/components/ui/reveal";`. `RevealScope` inside `DraftingSheet` children still sits under the header chrome Reveals' scope parent; the header chrome needs the same `contentCount`. Because the header is rendered by `DraftingSheet` outside this `RevealScope`, hoist the scope: wrap the whole `<DraftingSheet>` in `<RevealScope contentCount={3}>` instead of only the children.

- [ ] **Step 3: Landing**

In `LandingPage.tsx` wrap the whole returned `DraftingBoard` in `<RevealScope contentCount={2}>` and:

- header: `<Reveal as="header" ...>` is not needed; make the three children chrome reveals: brand `a` → `<Reveal as="a" kind="chrome" index={0} href="/" className="lp-brand">`, version span → `<Reveal as="span" kind="chrome" index={1} className="lp-version">`, `<nav>` → `<Reveal as="nav" kind="chrome" index={2} aria-label="Main navigation">`.
- stage: wrap the `<main>` in `<Reveal kind="content" index={0} className="relative min-[1000px]:absolute min-[1000px]:inset-0">…</Reveal>` and wrap `.lp-toolbar` + `.lp-prompt` + `<footer className="lp-local">` (the three stage siblings after `</main>`) in one `<Reveal kind="content" index={1} className="relative min-[1000px]:absolute min-[1000px]:inset-0">`. Check the `.lp-toolbar/.lp-prompt/.lp-local` rules at `landing-page.css:403-515` and the mobile overrides at `:639-690`: they use `position: absolute` relative to the stage on desktop and normal flow below 1000 px; the wrapper classes preserve both.

- [ ] **Step 4: Verify**

Run: `npx tsc -b && npx vitest run src/features/entry`
Expected: PASS.
Run: `npm run build`, then `TEST_PRODUCTION=1 npx playwright test tests/studio-landing.spec.ts tests/studio-entry.spec.ts tests/studio-design-language.spec.ts --workers=2`
Expected: PASS. Landing geometry assertions (`1440×900` board coordinates, 320 px reflow) must pass unchanged; if a measured coordinate shifted, the wrapper broke containing-block assumptions; fix the wrapper classes, not the test.

- [ ] **Step 5: Manual real-speed check**

Run `npm run dev -- --port 5173`, open `http://localhost:5173/` in the browser pane with motion on (no storage flag). Confirm: dots fade in, frame sweeps, header items then hero rise; click Try Beta → page content exits, dots shift, projects content enters; back works. Screenshot desktop (1440×900) and 390 px mobile; check no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`).

- [ ] **Step 6: Commit**

```bash
git add src/features/entry src/components/ui/drafting-sheet.tsx
git commit -m "feat(entry): reveal landing and projects pages"
```

---

### Task 6: Canvas enter and exit

**Files:**
- Create: `src/features/workspace/canvasTransition.ts`, `src/features/workspace/useCanvasTransition.ts`
- Modify: `src/features/workspace/Workspace.tsx` (root ref + hook call, root div at ~3213), `src/styles.css` (one rule)
- Test: `src/features/workspace/canvasTransition.test.ts`

**Interfaces:**
- Consumes: `CANVAS`, `CARD`, `EASE` (Task 1), `useRouteShell` (Task 4), `useMotionEnv`
- Produces:
  - `canvasEnterDelays(nodeCount: number, edgeCount: number): { nodeStep: number; barDelay: number }` (pure, tested)
  - `runCanvasEnter(root: HTMLElement, onReady: () => void): () => void` (returns stop/cleanup)
  - `runCanvasExit(root: HTMLElement): Promise<void>`
  - `useCanvasTransition(rootRef: React.RefObject<HTMLElement | null>): void`
  - attribute `data-canvas-entering` on the workspace root while hidden

- [ ] **Step 1: Failing test for the timing math**

`src/features/workspace/canvasTransition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canvasEnterDelays } from './canvasTransition';

describe('canvasEnterDelays', () => {
  it('uses the showcase 110 ms node stagger for small canvases', () => {
    expect(canvasEnterDelays(4, 3).nodeStep).toBeCloseTo(0.11, 5);
  });

  it('shrinks the stagger so a busy canvas finishes entering within the budget', () => {
    const { nodeStep } = canvasEnterDelays(40, 0);
    expect(nodeStep * 40).toBeCloseTo(1.2, 5);
  });

  it('starts bars after edges: edgeDelay + min(edges,4)*140ms + 520ms', () => {
    expect(canvasEnterDelays(3, 3).barDelay).toBeCloseTo(0.26 + 3 * 0.14 + 0.52, 5);
    expect(canvasEnterDelays(3, 99).barDelay).toBeCloseTo(0.26 + 4 * 0.14 + 0.52, 5);
  });
});
```

Run: `npx vitest run src/features/workspace/canvasTransition.test.ts` → FAIL (missing module).

- [ ] **Step 2: Implement `canvasTransition.ts`**

```ts
import { animate, stagger } from 'motion/react';
import { CANVAS, CARD, EASE } from '@/lib/motion/tokens';

export const ENTERING_ATTR = 'data-canvas-entering';
const EDGE_STAGGER = 0.14;

export function canvasEnterDelays(nodeCount: number, edgeCount: number) {
  const nodeStep = nodeCount > 0 ? Math.min(CANVAS.nodeStagger, CANVAS.nodeStaggerBudget / nodeCount) : CANVAS.nodeStagger;
  const barDelay = CANVAS.edgeDelay + Math.min(edgeCount, 4) * EDGE_STAGGER + CANVAS.barGap;
  return { nodeStep, barDelay };
}

interface Targets {
  /** First child of each ReactFlow node wrapper: the wrapper's own transform positions the node. */
  nodes: HTMLElement[];
  edges: HTMLElement | null;
  topbar: HTMLElement | null;
  bottom: HTMLElement | null;
}

function collect(root: HTMLElement): Targets {
  return {
    nodes: Array.from(root.querySelectorAll<HTMLElement>('.react-flow__node > :first-child')),
    edges: root.querySelector<HTMLElement>('.react-flow__edges'),
    topbar: root.querySelector<HTMLElement>('[data-testid="workspace-topbar"]'),
    bottom: root.querySelector<HTMLElement>('[data-testid="playback-panel"]'),
  };
}

function clear(els: HTMLElement[]) {
  els.forEach((el) => {
    el.style.removeProperty('opacity');
    el.style.removeProperty('transform');
    el.style.removeProperty('filter');
  });
}

/**
 * Hides, then animates nodes (stagger), edges (fade) and bars (slide). Waits for ReactFlow to
 * render its first nodes, then calls `onReady` (the card overlay starts fading) before animating.
 */
export function runCanvasEnter(root: HTMLElement, onReady: () => void): () => void {
  let frame = 0;
  let tries = 0;
  let stopped = false;
  const controls: { stop(): void }[] = [];
  let hidden: HTMLElement[] = [];

  const start = () => {
    const t = collect(root);
    hidden = [...t.nodes, t.edges, t.topbar, t.bottom].filter((el): el is HTMLElement => !!el);
    hidden.forEach((el) => {
      el.style.opacity = '0';
    });
    root.removeAttribute(ENTERING_ATTR);
    onReady();

    const edgeCount = root.querySelectorAll('.react-flow__edge').length;
    const { nodeStep, barDelay } = canvasEnterDelays(t.nodes.length, edgeCount);
    const gap = CARD.enterGap;
    const blur = t.nodes.length <= CANVAS.maxBlurNodes;

    if (t.nodes.length) {
      const keyframes = blur
        ? { opacity: [0, 1], y: [10, 0], scale: [0.96, 1], filter: ['blur(6px)', 'blur(0px)'] }
        : { opacity: [0, 1], y: [10, 0], scale: [0.96, 1] };
      const c = animate(t.nodes, keyframes, {
        duration: CANVAS.nodeDuration,
        delay: stagger(nodeStep, { startDelay: gap }),
        ease: EASE.enter,
      });
      controls.push(c);
      void c.then(() => clear(t.nodes));
    }
    if (t.edges) {
      const c = animate(t.edges, { opacity: [0, 1] }, { duration: CANVAS.edgeDuration, delay: gap + CANVAS.edgeDelay, ease: EASE.inOut });
      controls.push(c);
      void c.then(() => clear([t.edges!]));
    }
    if (t.topbar) {
      const c = animate(t.topbar, { opacity: [0, 1], y: [-CANVAS.barOffset, 0] }, { duration: CANVAS.barDuration, delay: gap + barDelay, ease: EASE.enter });
      controls.push(c);
      void c.then(() => clear([t.topbar!]));
    }
    if (t.bottom) {
      const c = animate(t.bottom, { opacity: [0, 1], y: [CANVAS.barOffset, 0] }, { duration: CANVAS.barDuration, delay: gap + barDelay, ease: EASE.enter });
      controls.push(c);
      void c.then(() => clear([t.bottom!]));
    }
  };

  const wait = () => {
    if (stopped) return;
    if (root.querySelector('.react-flow__node') || tries++ > 60) {
      start();
      return;
    }
    frame = requestAnimationFrame(wait);
  };
  frame = requestAnimationFrame(wait);

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    controls.forEach((c) => c.stop());
    clear(hidden);
    root.removeAttribute(ENTERING_ATTR);
  };
}

/** Bars slide away, nodes and edges fade. Resolves when everything has finished. */
export function runCanvasExit(root: HTMLElement): Promise<void> {
  const t = collect(root);
  const runs: PromiseLike<unknown>[] = [];
  if (t.topbar) runs.push(animate(t.topbar, { opacity: 0, y: -CANVAS.barOffset }, { duration: CANVAS.exitBar, ease: EASE.exit }));
  if (t.bottom) runs.push(animate(t.bottom, { opacity: 0, y: CANVAS.barOffset }, { duration: CANVAS.exitBar, ease: EASE.exit }));
  if (t.nodes.length) {
    runs.push(
      animate(
        t.nodes,
        { opacity: 0, filter: 'blur(6px)' },
        { duration: CANVAS.exitNode, delay: stagger(CANVAS.exitNodeStagger, { startDelay: CANVAS.exitNodeDelay }), ease: EASE.exit },
      ),
    );
  }
  if (t.edges) runs.push(animate(t.edges, { opacity: 0 }, { duration: CANVAS.exitNode, delay: CANVAS.exitNodeDelay, ease: EASE.exit }));
  return Promise.all(runs).then(() => undefined);
}
```

Run the test → PASS.

- [ ] **Step 3: Hook**

`src/features/workspace/useCanvasTransition.ts`:

```ts
import * as React from 'react';
import { usePresence } from 'motion/react';
import { useMotionEnv } from '@/lib/motion/env';
import { useRouteShell } from '@/lib/motion/shell-context';
import { ENTERING_ATTR, runCanvasEnter, runCanvasExit } from './canvasTransition';

/** Animates the project canvas in on mount and out when the shell removes the page. */
export function useCanvasTransition(rootRef: React.RefObject<HTMLElement | null>): void {
  const shell = useRouteShell();
  const env = useMotionEnv();
  const [isPresent, safeToRemove] = usePresence();
  const markReady = shell?.markReady;

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || env.reduced || !shell) {
      markReady?.();
      return;
    }
    root.setAttribute(ENTERING_ATTR, '');
    return runCanvasEnter(root, () => markReady?.());
    // Runs once per mount: route changes remount the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isPresent) return;
    const root = rootRef.current;
    if (!root || env.reduced) {
      safeToRemove?.();
      return;
    }
    runCanvasExit(root).then(
      () => safeToRemove?.(),
      () => safeToRemove?.(),
    );
  }, [isPresent, env.reduced, rootRef, safeToRemove]);
}
```

- [ ] **Step 4: Wire into Workspace and CSS**

`src/features/workspace/Workspace.tsx`:

- Near the top of the `Workspace` component body (above any conditional `return`; confirm with `grep -n "return null" src/features/workspace/Workspace.tsx` that no early return precedes it), add

```tsx
  const workspaceRootRef = React.useRef<HTMLDivElement>(null);
  useCanvasTransition(workspaceRootRef);
```

- On the root element (`data-testid="workspace-root"` at ~line 3213) add `ref={workspaceRootRef}`. Import `{ useCanvasTransition } from "./useCanvasTransition"`.

`src/styles.css` (after the `@layer base` blocks, unlayered on purpose: it must beat Tailwind utilities while the workspace is entering):

```css
/* Project canvas enter: hidden until ReactFlow has rendered, then animated in
   (features/workspace/canvasTransition.ts removes the attribute). */
[data-canvas-entering] .react-flow__node,
[data-canvas-entering] .react-flow__edges,
[data-canvas-entering] [data-testid="workspace-topbar"],
[data-canvas-entering] [data-testid="playback-panel"] {
  opacity: 0;
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc -b && npx vitest run src/features/workspace`
Expected: PASS.
Run: `npm run build`, then `TEST_PRODUCTION=1 npx playwright test tests/studio-project-canvas.spec.ts tests/studio-canvas-collapse.spec.ts tests/studio-panels.spec.ts --workers=2`
Expected: PASS (motion off ⇒ `env.reduced` ⇒ hook only calls `markReady`).
Then manual real-speed check in the browser pane with the storage flag cleared: open a project from `/projects`; nodes pop in staggered, edges fade, top bar slides down, playback bar slides up; click `← Projects`: bars slide away, nodes fade, projects page enters. Verify after the enter: `document.querySelector('.react-flow__node > :first-child').style.cssText === ''` (no leftover inline styles) and node positions unchanged (`getBoundingClientRect` before/after enter equals).

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/canvasTransition.ts src/features/workspace/canvasTransition.test.ts src/features/workspace/useCanvasTransition.ts src/features/workspace/Workspace.tsx src/styles.css
git commit -m "feat(workspace): animate canvas enter and exit"
```

---

### Task 7: Card-to-canvas overlay

**Files:**
- Create: `src/features/shell/overlayGeometry.ts`, `src/features/shell/CardOverlay.tsx`
- Modify: `src/features/shell/RouteShell.tsx`, `src/features/entry/EntryScreen.tsx` (open/create handlers)
- Test: `src/features/shell/overlayGeometry.test.ts`

**Interfaces:**
- Consumes: `CARD`, `EASE` (Task 1); `RouteShellApi` (Task 4)
- Produces:
  - `insetFromRect(rect: {left,top,right,bottom}, vw: number, vh: number): Inset`
  - `insetClip(inset: Inset, radius: number): string`
  - `finalInset(vw: number): Inset`
  - `opaqueColor(css: string): string`
  - `type OverlayStage = 'grow' | 'hold' | 'fade' | 'cancel'`; `interface OverlayState { bg: string; radius: number; inset: Inset; stage: OverlayStage }`
  - `<CardOverlay state onGrown onDone />`; test id `route-card-overlay`

- [ ] **Step 1: Failing geometry test**

`src/features/shell/overlayGeometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { finalInset, insetClip, insetFromRect, opaqueColor } from './overlayGeometry';

describe('overlay geometry', () => {
  it('converts a client rect to viewport insets', () => {
    expect(insetFromRect({ left: 100, top: 200, right: 300, bottom: 360 }, 1000, 800)).toEqual({
      top: 200,
      left: 100,
      right: 700,
      bottom: 440,
    });
  });

  it('clamps a card scrolled partly off screen', () => {
    expect(insetFromRect({ left: -20, top: 700, right: 300, bottom: 900 }, 1000, 800)).toEqual({
      top: 700,
      left: 0,
      right: 700,
      bottom: 0,
    });
  });

  it('formats a rounded inset clip-path', () => {
    expect(insetClip({ top: 1, right: 2, bottom: 3, left: 4 }, 9)).toBe('inset(1px 2px 3px 4px round 9px)');
  });

  it('ends at the frame inset on wide viewports and full-bleed on narrow ones', () => {
    expect(finalInset(1440)).toEqual({ top: 22, right: 22, bottom: 22, left: 22 });
    expect(finalInset(800)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('replaces transparent backgrounds with the card colour', () => {
    expect(opaqueColor('rgba(0, 0, 0, 0)')).toBe('var(--card, #fff)');
    expect(opaqueColor('rgb(11, 92, 84)')).toBe('rgb(11, 92, 84)');
  });
});
```

Run: `npx vitest run src/features/shell` → FAIL (missing module).

- [ ] **Step 2: Implement geometry**

`src/features/shell/overlayGeometry.ts`:

```ts
export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 100) / 100;

export function insetFromRect(
  rect: { left: number; top: number; right: number; bottom: number },
  vw: number,
  vh: number,
): Inset {
  return {
    top: round(clamp(rect.top, 0, vh)),
    left: round(clamp(rect.left, 0, vw)),
    right: round(clamp(vw - rect.right, 0, vw)),
    bottom: round(clamp(vh - rect.bottom, 0, vh)),
  };
}

export const insetClip = (i: Inset, radius: number) =>
  `inset(${i.top}px ${i.right}px ${i.bottom}px ${i.left}px round ${radius}px)`;

/** The sheet frame sits 22 px in on wide viewports; narrow layouts have no frame. */
export function finalInset(vw: number): Inset {
  const m = vw >= 1000 ? 22 : 0;
  return { top: m, right: m, bottom: m, left: m };
}

export function opaqueColor(css: string): string {
  return css === 'transparent' || css === 'rgba(0, 0, 0, 0)' ? 'var(--card, #fff)' : css;
}
```

Run the test → PASS.

- [ ] **Step 3: CardOverlay**

`src/features/shell/CardOverlay.tsx`:

```tsx
import * as React from 'react';
import { animate } from 'motion/react';
import { CARD, EASE } from '@/lib/motion/tokens';
import { finalInset, insetClip, type Inset } from './overlayGeometry';

export type OverlayStage = 'grow' | 'hold' | 'fade' | 'cancel';
export interface OverlayState {
  bg: string;
  radius: number;
  inset: Inset;
  stage: OverlayStage;
}

/** Solid copy of the clicked card that grows to the sheet, then fades over the entering canvas. */
export function CardOverlay({
  state,
  onGrown,
  onDone,
}: {
  state: OverlayState;
  onGrown: () => void;
  onDone: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const from = insetClip(state.inset, state.radius);
  const to = insetClip(finalInset(window.innerWidth), 0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (state.stage === 'grow') {
      const c = animate(el, { clipPath: [from, to] }, { duration: CARD.growDuration, delay: CARD.growDelay, ease: EASE.inOut });
      void c.then(onGrown);
      return () => c.stop();
    }
    if (state.stage === 'fade') {
      const c = animate(el, { opacity: [1, 0] }, { duration: CARD.fadeDuration, ease: [0.4, 0, 0.2, 1] });
      void c.then(onDone);
      return () => c.stop();
    }
    if (state.stage === 'cancel') {
      const c = animate(el, { clipPath: from }, { duration: CARD.cancelDuration, ease: EASE.inOut });
      void c.then(onDone);
      return () => c.stop();
    }
    // `hold` keeps the final clip; the shell moves to `fade` when the workspace is ready.
  }, [state.stage, from, to, onGrown, onDone]);

  return (
    <div
      ref={ref}
      data-testid="route-card-overlay"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[100]"
      style={{ background: state.bg, clipPath: from }}
    />
  );
}
```

- [ ] **Step 4: Extend RouteShell with the overlay state machine**

Replace the placeholder `api` and add the overlay logic in `src/features/shell/RouteShell.tsx`:

```tsx
import { CARD } from '@/lib/motion/tokens';
import { CardOverlay, type OverlayState } from './CardOverlay';
import { insetFromRect, opaqueColor } from './overlayGeometry';

// inside RouteShell:
  const [overlay, setOverlay] = React.useState<OverlayState | null>(null);
  const overlayRef = React.useRef<OverlayState | null>(null);
  const hiddenEl = React.useRef<HTMLElement | null>(null);
  const grown = React.useRef<{ promise: Promise<void>; resolve: () => void }>({ promise: Promise.resolve(), resolve() {} });

  const update = React.useCallback((next: OverlayState | null) => {
    overlayRef.current = next;
    setOverlay(next);
  }, []);

  const restoreCard = React.useCallback(() => {
    if (hiddenEl.current) hiddenEl.current.style.opacity = '';
    hiddenEl.current = null;
  }, []);

  const beginOpen = React.useCallback(
    (el: HTMLElement) => {
      if (env.reduced || overlayRef.current) return;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      let resolve = () => {};
      const promise = new Promise<void>((r) => (resolve = r));
      grown.current = { promise, resolve };
      hiddenEl.current = el;
      el.style.opacity = '0';
      update({
        bg: opaqueColor(cs.backgroundColor),
        radius: parseFloat(cs.borderTopLeftRadius) || 0,
        inset: insetFromRect(rect, window.innerWidth, window.innerHeight),
        stage: 'grow',
      });
      setPhase('exit');
    },
    [env.reduced, update],
  );

  const cancelOpen = React.useCallback(() => {
    const o = overlayRef.current;
    if (!o) return;
    grown.current.resolve();
    update({ ...o, stage: 'cancel' });
    setPhase('enter');
  }, [update]);

  const markReady = React.useCallback(() => {
    const o = overlayRef.current;
    if (o && o.stage === 'hold') update({ ...o, stage: 'fade' });
  }, [update]);

  const onOverlayDone = React.useCallback(() => {
    restoreCard();
    update(null);
  }, [restoreCard, update]);

  const api = React.useMemo<RouteShellApi>(
    () => ({ beginOpen, cancelOpen, markReady, setGroundPaused }),
    [beginOpen, cancelOpen, markReady],
  );
```

Replace the route-sync effect so the swap to `project` waits for the grow, then holds the overlay:

```tsx
  React.useEffect(() => {
    if (target === page.kind) return;
    let alive = true;
    void (async () => {
      if (target === 'project' && overlayRef.current?.stage === 'grow') await grown.current.promise;
      if (!alive) return;
      setShift((s) => ({ dir: pageDirection(page.kind, target) || 1, n: s.n + 1 }));
      setPage({ kind: target, baseDelay: overlayRef.current ? 0 : BOARD.shiftDelay });
      setPhase('enter');
      const o = overlayRef.current;
      if (o && o.stage === 'grow') update({ ...o, stage: 'hold' });
    })();
    return () => {
      alive = false;
    };
  }, [target, page.kind, update]);

  // The overlay never outlives a stuck workspace.
  React.useEffect(() => {
    if (overlay?.stage !== 'hold') return;
    const id = window.setTimeout(markReady, CARD.readyTimeout * 1000);
    return () => window.clearTimeout(id);
  }, [overlay?.stage, markReady]);
```

Render the overlay as the last child inside the shell root:

```tsx
        {overlay && <CardOverlay state={overlay} onGrown={grown.current.resolve} onDone={onOverlayDone} />}
```

`onGrown` must be read through the ref at call time (`grown.current.resolve` captured at render is replaced by `beginOpen`), so pass `onGrown={() => grown.current.resolve()}` with a stable callback via `useCallback(() => grown.current.resolve(), [])`.

If the open succeeds but `overlay.stage` is still `'grow'` when the workspace marks ready (very fast machines), `markReady` ignores it and the `hold` timeout releases the overlay at most 3 s later; to avoid that, after `update({ ...o, stage: 'hold' })` in the swap effect call `markReady` again only from the workspace, as designed (Task 6 calls `markReady` after render, i.e. after `hold`). Do not shortcut.

- [ ] **Step 5: Hook EntryScreen**

In `EntryScreen.tsx` import `useRouteShell` (`@/lib/motion/shell-context`) and add `const shell = useRouteShell();`. Update the three handlers so the overlay starts before the async call and is cancelled on failure:

- `handleOpenProject(projectId, branchId, source?: HTMLElement | null)`: before `setIsSubmitting(true)` call `shell?.beginOpen(source ?? undefined as never)` only when `source` is set; in the `else` branch (status not ready) and in the `catch`, call `shell?.cancelOpen()` before setting the error message. The existing `open-project-*` button passes its card: `onClick={(e) => handleOpenProject(row.project.id, row.target!.branchId, e.currentTarget.closest('article'))}`.
- `handleCreateBlankProject`: capture `const tile = (e?.currentTarget as HTMLElement | undefined) ?? null;` (the `form`); call `shell?.beginOpen(tile)` when set; cancel on non-`applied` and in `catch`.
- `handleCreateExample(example, row?: HTMLElement | null)`: the Create button passes `e.currentTarget.closest('[data-example-row]')`; add `data-example-row` to the example row `div`; same begin/cancel pattern.

(Cancel in each failure path; success paths are untouched because `onOpenSuccess` navigates and the shell takes over.)

- [ ] **Step 6: Verify**

Run: `npx tsc -b && npx vitest run`
Expected: PASS.
Run: `npm run build`, then `TEST_PRODUCTION=1 npx playwright test tests/studio-entry.spec.ts tests/studio-authoring.spec.ts tests/studio-panels.spec.ts --workers=2`
Expected: PASS with motion off (reduced ⇒ `beginOpen` no-ops).
Manual real-speed check (storage flag cleared): open an existing project: card hides, overlay grows to the frame, other content fades, canvas enters under the fading overlay; simulate failure (`indexedDB` delete the project row, then click) → overlay shrinks back and the error banner shows. Screenshot mid-grow.

- [ ] **Step 7: Commit**

```bash
git add src/features/shell src/features/entry/EntryScreen.tsx
git commit -m "feat(shell): card-to-canvas overlay when opening a project"
```

---

### Task 8: Real-speed e2e, full verification, docs

**Files:**
- Create: `tests/route-transitions.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-07-route-transitions-design.md` (append amendments), `HANDOFF.md`, `ACTION_LOG.md`, `LESSONS.md` (only if a lesson occurred)

**Interfaces:**
- Consumes: test ids `route-board` (`data-intro`), `route-card-overlay`, `topbar-back`, `entry-screen-root`, `landing-page`, `workspace-root`, `create-example-s04`.

- [ ] **Step 1: Write the e2e spec**

`tests/route-transitions.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

// These tests run at real animation speed: clear the suite-wide motion-off flag.
test.use({ storageState: { cookies: [], origins: [] } });

const trackOverlay = (page: Page) =>
  page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="route-card-overlay"]')) (window as unknown as { __overlaySeen: boolean }).__overlaySeen = true;
    }).observe(document, { subtree: true, childList: true });
  });
const overlaySeen = (page: Page) => page.evaluate(() => !!(window as unknown as { __overlaySeen?: boolean }).__overlaySeen);

test('the board persists across home and projects and swaps page content', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await expect(page.getByTestId('route-board')).toHaveAttribute('data-intro', 'true');
  await page.getByTestId('route-board').evaluate((el) => ((el as unknown as { __id: string }).__id = 'same'));
  await page.getByRole('link', { name: 'Try Beta' }).last().click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await expect(page.locator('[data-page-kind="home"]')).toHaveCount(0);
  expect(await page.getByTestId('route-board').evaluate((el) => (el as unknown as { __id: string }).__id)).toBe('same');
  await page.goBack();
  await expect(page.getByTestId('landing-page')).toBeVisible();
});

test('rapid forward/back navigation settles on the last route', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await page.getByRole('link', { name: 'Try Beta' }).last().click();
  await page.goBack();
  await page.goForward();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await expect(page.locator('[data-page-kind]')).toHaveCount(1);
});

test('opening a project grows a card overlay, then the canvas enters and back returns', async ({ page }) => {
  await trackOverlay(page);
  await page.goto('/projects');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('route-card-overlay')).toHaveCount(0, { timeout: 10000 });
  expect(await overlaySeen(page)).toBe(true);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  const inline = await page.locator('.react-flow__node > :first-child').first().evaluate((el) => (el as HTMLElement).style.cssText);
  expect(inline).toBe('');
  await page.getByTestId('topbar-back').click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await expect(page.locator('[data-page-kind="project"]')).toHaveCount(0);
});

test('a deep link skips the board intro and plays only the canvas enter', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('route-board')).toHaveAttribute('data-intro', 'false');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});

test.describe('reduced motion', () => {
  test.use({ colorScheme: 'light' });
  test('no overlay, no intro, content visible immediately', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await trackOverlay(page);
    await page.goto('/projects');
    await expect(page.getByTestId('route-board')).toHaveAttribute('data-intro', 'false');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15000 });
    expect(await overlaySeen(page)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new spec**

Run: `npm run build && TEST_PRODUCTION=1 npx playwright test tests/route-transitions.spec.ts --workers=1`
Expected: 5 passed. If `data-intro` is `"false"` on a fresh `/` load, the test run is inheriting reduced motion; check `playwright.config.ts` has no `reducedMotion`. Record any flake and rerun once; report both results (LESSONS: one pass doesn't prove a flaky test fixed).

- [ ] **Step 3: Full verification on an isolated port**

Create a throwaway repo-local config `playwright.isolated.config.ts` (untracked, delete afterwards) identical to `playwright.config.ts` but with `baseURL`/`webServer` on port `5190` (`npx vite preview --host 127.0.0.1 --port 5190`), `reuseExistingServer: false`, `workers: 2`, `retries: 0`, and `TEST_PRODUCTION=1`.

Run: `npm run build && TEST_PRODUCTION=1 npx playwright test -c playwright.isolated.config.ts`
Expected: full suite passes (previous baseline: 152 passed, 4 dev-only skipped); report exact counts. Also run `npm test` (expect ~1,831 + new tests passed, 11 skipped), `npm run build-storybook` (success), and confirm `npm run build` prints no chunk-size warning (note the `motion` chunk size).

Then check by hand at real speed (storage flag cleared) at 1440×900, 1000, 800, 390 and 320 widths: intro, home→projects→project→back, no horizontal overflow (`scrollWidth`), TopBar header at each width, rapid back/forward. Screenshot desktop and 390 px via `test.info().outputPath` or the browser pane.

Remove `playwright.isolated.config.ts`.

- [ ] **Step 4: Spec amendments**

Append to `docs/superpowers/specs/2026-10-07-route-transitions-design.md`:

```markdown
## Amendments (2026-10-07, from the implementation plan)

1. E2E disables motion with `localStorage['studio:motion'] = 'off'` (Playwright `storageState`), not a `window` global; the landing demo's existing reduced-motion tests make a global `reducedMotion` emulation unsuitable.
2. The Workspace keeps its own frame, padding and static dots. The shell board fades out beneath the card overlay; the Workspace height model is untouched. This supersedes "replace `workspace-frame`" in Architecture §7.
3. Canvas edges fade in as a group instead of drawing along `pathLength`; `TrafficEdge` renders multi-layer lanes.
4. `Reveal` has two kinds (`content`, `chrome`); node/edge/bar choreography is imperative (`canvasTransition.ts`) because ReactFlow owns node `transform`.
5. Rapid navigation relies on `AnimatePresence mode="wait"` last-wins behaviour, covered by an e2e test; there is no custom queue.
6. The board frame intro is a clip-path sweep of the existing frame.
```

- [ ] **Step 5: Handoff and action log**

Update `HANDOFF.md` (top paragraph: transitions implemented, file map from the table above, motion-off flag, the six deviations, verification counts) and append to `ACTION_LOG.md` under `2026-10-07`: outcome, files changed, platform (Claude, no subagents unless used), verification results, limitations (edge fade vs draw; manual real-speed review recorded; any flaky retries). Add a `Lesson:` line and a `LESSONS.md` rule only if something failed or surprised during execution.

- [ ] **Step 6: Final diff review and commit**

Run: `git status --short && git diff --stat`
Expected: every changed file belongs to this plan; no stray `.js` beside sources (LESSONS: no `--noEmit false`), no `playwright.isolated.config.ts`.

```bash
git add -A
git commit -m "test(shell): real-speed route transition e2e; docs and handoff"
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Motion library, `LazyMotion` + `domAnimation`, tokens in one place | 1, 2 |
| `Reveal` primitive, roles, stagger and chrome-after-content timing | 1, 2, 5 |
| `RouteShell` with `AnimatePresence mode="wait"`, keyed by route kind, direction | 1, 4 |
| Persistent board, intro on every full load of `/` and `/projects`, deep-link skips | 4, 8 |
| Dots shift ±24 px with dip on page change | 4 |
| Card overlay: capture rect/bg/radius, grow, wait for workspace ready, fade; failure reverses | 7 |
| Canvas enter (nodes, edges, bars) and exit (back) | 6 |
| Guarded back navigation starts exit only after the guard passes | 6 (exit starts on route change, after `runGuarded` calls `onBackToProjects`); verify in Task 8 manual check |
| Header: static logo, `← Projects`, divider, title; `BrandMark` + Storybook | 3 |
| Reduced motion: opacity-only, no overlay, no intro | 1 (`revealSpec`), 4 (`intro && !reduced`), 6 (`env.reduced`), 7 (`beginOpen` no-op) |
| Focus management on route enter; `inert` on exiting content | **Not covered above.** See follow-up note below. |
| Blur capped on many nodes / coarse pointers | 1 (`coarse`), 6 (`maxBlurNodes`) |
| Unit, e2e (motion off + real speed + reduced + deep link), bundle, Storybook | 1–8 |

**Gap found and decision:** the spec's accessibility bullets (focus after enter, `inert` on exiting content) were not in Tasks 4-7, so they are Task 4 Step 7 below; nothing else is missing.

**Placeholder scan:** the only non-literal items are Task 7 Step 5 (handler edits described against code that was read, with exact patterns) and Task 5 Step 3 (wrapper placement validated by the landing geometry tests). Both give exact classes/props to apply.

**Type consistency:** `RevealKind` (`'content'|'chrome'`) is used by `Reveal` (`kind` prop) and `revealSpec`; `RevealScopeValue` fields `contentCount`/`baseDelay` match `RevealScope`; `PageKind` is produced in Task 1 and consumed by `RouteShell`/`App`; `RouteShellApi` has the same four methods in the context file, the Task 4 test and Task 7's `useMemo`; `OverlayStage` values (`grow|hold|fade|cancel`) match their uses; `ENTERING_ATTR` is shared by `canvasTransition.ts`, `useCanvasTransition.ts` and the CSS rule's literal `data-canvas-entering`.
