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
  const runs: { then(onResolve: () => void, onReject?: () => void): Promise<void> }[] = [];
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
  return Promise.all(
    runs.map((run) => new Promise<void>((resolve, reject) => void run.then(resolve, reject))),
  ).then(() => undefined);
}
