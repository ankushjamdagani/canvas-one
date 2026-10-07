import * as React from 'react';
import { AnimatePresence, m, useIsPresent } from 'motion/react';
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

function PageA11y() {
  const isPresent = useIsPresent();
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const frame = ref.current?.parentElement;
    if (!frame) return;
    // Leaving content must not take focus or be read while it animates away.
    frame.inert = !isPresent;
  }, [isPresent]);
  return <span ref={ref} hidden />;
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
  // Focus moves to the heading only after a route change; first load keeps Tab starting at the header.
  const swapped = React.useRef(false);

  React.useEffect(() => {
    if (target === page.kind) return;
    setShift((s) => ({ dir: pageDirection(page.kind, target) || 1, n: s.n + 1 }));
    swapped.current = true;
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
            onAnimationComplete={(def) => {
              if (def !== 'enter' || !swapped.current || document.activeElement !== document.body) return;
              document.querySelector<HTMLElement>(`[data-page-kind="${page.kind}"] h1`)?.focus({ preventScroll: true });
            }}
          >
            <PageA11y />
            <RevealScope baseDelay={page.baseDelay}>{renderPage(page.kind)}</RevealScope>
          </m.div>
        </AnimatePresence>
      </div>
    </RouteShellContext.Provider>
  );
}
