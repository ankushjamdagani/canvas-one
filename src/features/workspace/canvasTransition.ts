import { animate, stagger } from 'motion/react';
import { CANVAS, CARD, EASE } from '@/lib/motion/tokens';

export const ENTERING_ATTR = 'data-canvas-entering';
const EDGE_STAGGER = 0.14;

/** Seconds after the enter starts at which edge `index` begins drawing. */
export function canvasEdgeDelay(index: number) {
  return CANVAS.edgeDelay + Math.min(index, 4) * EDGE_STAGGER;
}

export function canvasEnterDelays(nodeCount: number, edgeCount: number) {
  const nodeStep = nodeCount > 0 ? Math.min(CANVAS.nodeStagger, CANVAS.nodeStaggerBudget / nodeCount) : CANVAS.nodeStagger;
  const barDelay = CANVAS.edgeDelay + Math.min(edgeCount, 4) * EDGE_STAGGER + CANVAS.barGap;
  return { nodeStep, barDelay };
}

interface Targets {
  /** First child of each ReactFlow node wrapper: the wrapper's own transform positions the node. */
  nodes: HTMLElement[];
  edges: HTMLElement | null;
  edgePaths: SVGPathElement[];
  edgeLabels: HTMLElement | null;
  topbar: HTMLElement | null;
  bottom: HTMLElement | null;
}

function collect(root: HTMLElement): Targets {
  return {
    nodes: Array.from(root.querySelectorAll<HTMLElement>('.react-flow__node > :first-child')),
    edges: root.querySelector<HTMLElement>('.react-flow__edges'),
    edgePaths: Array.from(root.querySelectorAll<SVGPathElement>('.react-flow__edge-path')),
    edgeLabels: root.querySelector<HTMLElement>('.react-flow__edgelabel-renderer'),
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

interface DrawnEdge {
  path: SVGPathElement;
  dasharray: string;
  dashoffset: string;
  marker: string | null;
}

/** Hides the stroke with a dash gap (and the arrow head) so it can be drawn along its length. */
function prepareEdge(path: SVGPathElement): DrawnEdge & { length: number } {
  const length = Math.ceil(path.getTotalLength()) + 1;
  const saved = {
    path,
    length,
    dasharray: path.style.strokeDasharray,
    dashoffset: path.style.strokeDashoffset,
    marker: path.getAttribute('marker-end'),
  };
  path.style.strokeDasharray = `${length} ${length}`;
  path.style.strokeDashoffset = String(length);
  path.removeAttribute('marker-end');
  return saved;
}

function restoreEdge(edge: DrawnEdge) {
  edge.path.style.strokeDasharray = edge.dasharray;
  edge.path.style.strokeDashoffset = edge.dashoffset;
  if (!edge.dasharray) edge.path.style.removeProperty('stroke-dasharray');
  if (!edge.dashoffset) edge.path.style.removeProperty('stroke-dashoffset');
  if (edge.marker) edge.path.setAttribute('marker-end', edge.marker);
}

/**
 * Hides, then animates nodes (stagger), edges (drawn along their path) and bars (slide). Waits for ReactFlow to
 * render its first nodes, then calls `onReady` (the card overlay starts fading) before animating.
 */
export function runCanvasEnter(root: HTMLElement, onReady: () => void): () => void {
  let frame = 0;
  let tries = 0;
  let stopped = false;
  const controls: { stop(): void }[] = [];
  let hidden: HTMLElement[] = [];
  const drawn: DrawnEdge[] = [];
  const drawnPaths = new Set<SVGPathElement>();
  let observer: MutationObserver | null = null;
  let observerTimer = 0;

  const start = () => {
    const t = collect(root);
    hidden = [...t.nodes, t.edgeLabels, t.topbar, t.bottom].filter((el): el is HTMLElement => !!el);
    hidden.forEach((el) => {
      el.style.opacity = '0';
    });
    // Strokes are hidden before the edge layer becomes visible, so nothing flashes.
    root.removeAttribute(ENTERING_ATTR);
    onReady();

    const edgeCount = root.querySelectorAll('.react-flow__edge').length;
    const { nodeStep, barDelay } = canvasEnterDelays(t.nodes.length, Math.max(edgeCount, 3));
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
    // ReactFlow renders edges after it has measured nodes, so some arrive after this point:
    // prepare them in the same task (before paint) and draw them with the same stagger.
    const drawEdge = (path: SVGPathElement) => {
      if (drawnPaths.has(path)) return;
      drawnPaths.add(path);
      const edge = prepareEdge(path);
      drawn.push(edge);
      const c = animate(edge.length, 0, {
        duration: CANVAS.edgeDuration,
        delay: gap + canvasEdgeDelay(drawnPaths.size - 1),
        ease: EASE.inOut,
        onUpdate: (value) => {
          edge.path.style.strokeDashoffset = String(value);
        },
      });
      controls.push(c);
      void c.then(() => restoreEdge(edge));
    };
    t.edgePaths.forEach(drawEdge);
    const edgesRoot = t.edges ?? root;
    observer = new MutationObserver(() => {
      root.querySelectorAll<SVGPathElement>('.react-flow__edge-path').forEach(drawEdge);
    });
    observer.observe(edgesRoot, { childList: true, subtree: true });
    observerTimer = window.setTimeout(() => observer?.disconnect(), 1500);
    if (t.edgeLabels) {
      const c = animate(t.edgeLabels, { opacity: [0, 1] }, { duration: 0.4, delay: gap + canvasEdgeDelay(4) + CANVAS.edgeDuration, ease: EASE.enter });
      controls.push(c);
      void c.then(() => clear([t.edgeLabels!]));
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
    observer?.disconnect();
    window.clearTimeout(observerTimer);
    drawn.forEach(restoreEdge);
    root.removeAttribute(ENTERING_ATTR);
  };
}

/**
 * Bars slide away; nodes, edges and edge labels fade. `done` resolves when everything has
 * finished; `stop` cancels it and restores every touched element (the page became present again).
 */
export function runCanvasExit(root: HTMLElement): { done: Promise<void>; stop: () => void } {
  const t = collect(root);
  const runs: { stop(): void; then(onResolve: () => void, onReject?: () => void): Promise<void> }[] = [];
  const touched: HTMLElement[] = [];
  const track = <T extends { stop(): void; then(onResolve: () => void, onReject?: () => void): Promise<void> }>(el: HTMLElement | HTMLElement[], run: T) => {
    touched.push(...(Array.isArray(el) ? el : [el]));
    runs.push(run);
  };
  if (t.topbar) track(t.topbar, animate(t.topbar, { opacity: 0, y: -CANVAS.barOffset }, { duration: CANVAS.exitBar, ease: EASE.exit }));
  if (t.bottom) track(t.bottom, animate(t.bottom, { opacity: 0, y: CANVAS.barOffset }, { duration: CANVAS.exitBar, ease: EASE.exit }));
  if (t.nodes.length) {
    track(
      t.nodes,
      animate(
        t.nodes,
        { opacity: 0, filter: 'blur(6px)' },
        { duration: CANVAS.exitNode, delay: stagger(CANVAS.exitNodeStagger, { startDelay: CANVAS.exitNodeDelay }), ease: EASE.exit },
      ),
    );
  }
  for (const layer of [t.edges, t.edgeLabels]) {
    if (layer) track(layer, animate(layer, { opacity: 0 }, { duration: CANVAS.exitNode, delay: CANVAS.exitNodeDelay, ease: EASE.exit }));
  }
  const done = Promise.all(
    runs.map((run) => new Promise<void>((resolve, reject) => void run.then(resolve, reject))),
  ).then(() => undefined);
  return {
    done,
    stop() {
      runs.forEach((run) => run.stop());
      clear(touched);
    },
  };
}
