import * as React from 'react';
import { m, useAnimationControls, useIsPresent } from 'motion/react';
import { useMotionEnv } from '@/lib/motion/env';
import {
  EASE,
  revealSpec,
  type RevealKind,
  type RevealScopeValue,
  type RevealSpec,
} from '@/lib/motion/tokens';

type Scope = RevealScopeValue & { phase?: 'enter' | 'exit'; onEntered?: (element: HTMLElement) => void };
const ScopeContext = React.createContext<Scope>({ contentCount: 0, baseDelay: 0 });

/** Page-level context for stagger counts and the page's start delay. Omitted fields inherit. */
export function RevealScope({
  contentCount,
  baseDelay,
  phase,
  onEntered,
  children,
}: {
  contentCount?: number;
  baseDelay?: number;
  phase?: 'enter' | 'exit';
  onEntered?: (element: HTMLElement) => void;
  children?: React.ReactNode;
}) {
  const parent = React.useContext(ScopeContext);
  const value = React.useMemo(
    () => ({ contentCount: contentCount ?? parent.contentCount, baseDelay: baseDelay ?? parent.baseDelay, phase: phase ?? parent.phase, onEntered: onEntered ?? parent.onEntered }),
    [contentCount, baseDelay, phase, onEntered, parent.contentCount, parent.baseDelay, parent.phase, parent.onEntered],
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
    transitionEnd: { filter: 'none' },
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
  p: m.p,
  figure: m.figure,
  form: m.form,
} as const;
export type RevealTag = keyof typeof TAGS;

type HtmlProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'style' | 'onSubmit'
>;
export type RevealProps = HtmlProps & {
  as?: RevealTag;
  kind?: RevealKind;
  /** Position among siblings of the same kind (drives the stagger). */
  index?: number;
  style?: React.CSSProperties;
  href?: string;
  onSubmit?: React.ComponentProps<'form'>['onSubmit'];
};

/**
 * Animates in and out with its page. Outside a shell page it renders as a plain element.
 * `filter` is cleared after entering so a finished reveal creates no stacking context.
 */
export function Reveal({ as = 'div', kind = 'content', index = 0, children, ...rest }: RevealProps) {
  const scope = React.useContext(ScopeContext);
  const env = useMotionEnv();
  const isPresent = useIsPresent();
  const phase = isPresent ? scope.phase : 'exit';
  const controls = useAnimationControls();
  const element = React.useRef<HTMLElement>(null);
  const previousPhase = React.useRef(scope.phase);
  // CSS owns entry from first paint, including server HTML before hydration.
  // Motion owns exit only; hydration must never rewind an already-painted entry.
  React.useLayoutEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = scope.phase;
    if (!scope.phase) return;
    if (scope.phase !== 'exit') {
      controls.stop();
      if (previous === 'exit' && element.current) {
        element.current.style.opacity = rest.style?.opacity?.toString() ?? '';
        element.current.style.transform = rest.style?.transform ?? '';
        element.current.style.filter = rest.style?.filter ?? '';
      }
      return;
    }
    void controls.start('exit');
    return () => controls.stop();
  }, [controls, scope.phase, env.reduced, env.off, env.coarse]);
  const custom = React.useMemo<Custom>(
    () => ({
      enter: revealSpec(kind, 'enter', index, scope, env),
      exit: revealSpec(kind, 'exit', index, scope, env),
    }),
    [kind, index, scope, env],
  );
  const Tag = TAGS[as] as React.ElementType;
  return (
    <Tag
      {...rest}
      style={scope.phase ? {
        ...rest.style,
        '--reveal-y': `${custom.enter.y}px`,
        '--reveal-blur': `${custom.enter.blur}px`,
        '--reveal-duration': `${custom.enter.duration}s`,
        '--reveal-delay': `${custom.enter.delay}s`,
      } as React.CSSProperties : rest.style}
      ref={element}
      variants={revealVariants}
      custom={custom}
      initial={false}
      animate={scope.phase ? controls : undefined}
      exit="exit"
      data-reveal-phase={phase}
      onAnimationEnd={(event: React.AnimationEvent<HTMLElement>) => {
        rest.onAnimationEnd?.(event);
        if (event.target === event.currentTarget && event.animationName.endsWith('studio-reveal-enter')) {
          scope.onEntered?.(event.currentTarget);
        }
      }}
      data-reveal-kind={kind}
      data-reveal-index={index}
    >
      {children}
    </Tag>
  );
}
