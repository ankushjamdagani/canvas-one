import * as React from 'react';
import { AnimatePresence, m, useIsPresent } from 'motion/react';
import { RevealScope } from '@/components/ui/reveal';
import { useInternalLinks, useRoute } from '@/lib/router';
import { pageDirection, type PageKind } from '@/lib/motion/direction';
import { useMotionEnv } from '@/lib/motion/env';
import { RouteShellContext, type RouteShellApi } from '@/lib/motion/shell-context';
import { BOARD, CARD } from '@/lib/motion/tokens';
import { BoardLayer, type BoardShift } from './BoardLayer';
import { CardOverlay, type OverlayState } from './CardOverlay';
import { insetFromRect, opaqueColor } from './overlayGeometry';

const PAGE_VARIANTS = { hidden: {}, enter: {}, exit: {} };

interface Page {
  kind: PageKind;
  shift?: BoardShift;
  /** Seconds the page waits before its reveals start. */
  baseDelay: number;
}

function PageA11y({ exiting, onMount }: { exiting: boolean; onMount: () => void }) {
  const isPresent = useIsPresent();
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(onMount, [onMount]);
  React.useLayoutEffect(() => {
    const frame = ref.current?.parentElement;
    if (!frame) return;
    // Leaving content (including the card-open fade before navigation) must not take focus,
    // receive clicks or be read while it animates away.
    frame.inert = !isPresent || exiting;
  }, [isPresent, exiting]);
  return <span ref={ref} hidden />;
}

export function RouteShell({ renderPage }: { renderPage: (kind: PageKind) => React.ReactNode }) {
  const env = useMotionEnv();
  const { route } = useRoute();
  useInternalLinks();
  const target: PageKind = route.kind;

  const intro = React.useRef(target !== 'project').current;
  const [page, setPage] = React.useState<Page>(() => ({
    kind: target,
    baseDelay: intro && !env.reduced ? BOARD.pageDelay : 0,
  }));
  const [shift, setShift] = React.useState<BoardShift>({ dir: 0, n: 0 });
  const [boardVisible, setBoardVisible] = React.useState(target !== 'project');
  const [groundPaused, setGroundPaused] = React.useState(false);
  const [phase, setPhase] = React.useState<'enter' | 'exit'>('enter');
  const [overlay, setOverlay] = React.useState<OverlayState | null>(null);
  const overlayRef = React.useRef<OverlayState | null>(null);
  const hiddenEl = React.useRef<HTMLElement | null>(null);
  const grown = React.useRef<{ promise: Promise<void>; resolve: () => void }>({ promise: Promise.resolve(), resolve() {} });
  // Focus moves to the heading only after a route change; first load keeps Tab starting at the header.
  const swapped = React.useRef(false);

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

  const onOverlayGrown = React.useCallback(() => grown.current.resolve(), []);

  React.useEffect(() => {
    if (target !== 'project' && overlayRef.current && overlayRef.current.stage !== 'cancel') {
      cancelOpen();
    }
    if (target === page.kind) return;
    let alive = true;
    void (async () => {
      if (target === 'project' && overlayRef.current?.stage === 'grow') await grown.current.promise;
      if (!alive) return;
      swapped.current = true;
      setPage({ kind: target, baseDelay: overlayRef.current ? 0 : BOARD.shiftDelay,
        shift: { dir: pageDirection(page.kind, target) || 1, n: performance.now() } });
      setPhase('enter');
      const o = overlayRef.current;
      if (o && o.stage === 'grow') update({ ...o, stage: 'hold' });
    })();
    return () => {
      alive = false;
    };
  }, [target, page.kind, update, cancelOpen]);

  const mountedPage = React.useCallback(() => {
    if (swapped.current) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    setBoardVisible(page.kind !== 'project');
    if (page.shift) setShift(page.shift);
  }, [page.kind, page.shift]);

  const revealedPage = React.useCallback((element: HTMLElement) => {
    const frame = element.closest<HTMLElement>('[data-page-kind]');
    if (!swapped.current || frame?.dataset.pageKind !== page.kind || frame.inert || document.activeElement !== document.body) return;
    element.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [page.kind]);

  // The overlay never outlives a stuck workspace.
  React.useEffect(() => {
    if (overlay?.stage !== 'hold') return;
    const id = window.setTimeout(markReady, CARD.readyTimeout * 1000);
    return () => window.clearTimeout(id);
  }, [overlay?.stage, markReady]);

  const api = React.useMemo<RouteShellApi>(
    () => ({ beginOpen, cancelOpen, markReady, setGroundPaused }),
    [beginOpen, cancelOpen, markReady],
  );

  return (
    <RouteShellContext.Provider value={api}>
      <div className="relative isolate min-h-svh bg-shell">
        <BoardLayer visible={boardVisible} intro={intro} shift={shift} paused={groundPaused} />
        <AnimatePresence mode="wait">
          <m.div
            key={page.kind}
            data-page-kind={page.kind}
            className="relative z-10"
            variants={PAGE_VARIANTS}
            initial={false}
            animate={phase}
            exit="exit"
          >
            <PageA11y exiting={phase === 'exit'} onMount={mountedPage} />
            <RevealScope baseDelay={page.baseDelay} phase={phase} onEntered={revealedPage}>{renderPage(page.kind)}</RevealScope>
          </m.div>
        </AnimatePresence>
        {overlay && <CardOverlay state={overlay} onGrown={onOverlayGrown} onDone={onOverlayDone} />}
      </div>
    </RouteShellContext.Provider>
  );
}
