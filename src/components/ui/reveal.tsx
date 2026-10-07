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
  children?: React.ReactNode;
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
      variants={revealVariants}
      custom={custom}
      data-reveal-kind={kind}
      data-reveal-index={index}
    >
      {children}
    </Tag>
  );
}
