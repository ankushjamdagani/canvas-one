import { animate as animateValue, stagger } from 'motion/react';
import { animate } from 'motion/mini';
import { CANVAS, CARD, EASE } from '@/lib/motion/tokens';

export const ENTERING_ATTR = 'data-canvas-entering';
const EDGE_STAGGER = 0.14;

/** Seconds after the enter starts at which edge `index` begins drawing. */
export function canvasEdgeDelay(index: number) {
  return CANVAS.edgeDelay + Math.min(index, 8) * EDGE_STAGGER;
}

export function canvasEnterDelays(nodeCount: number, edgeCount: number) {
  const nodeStep = nodeCount > 0 ? Math.min(CANVAS.nodeStagger, CANVAS.nodeStaggerBudget / nodeCount) : CANVAS.nodeStagger;
  const barDelay = CANVAS.edgeDelay + Math.min(edgeCount, 8) * EDGE_STAGGER + CANVAS.barGap;
  return { nodeStep, barDelay };
}

/** Explicit endpoints prevent Motion from interpolating a missing scale in `none` as zero. */
export function canvasNodeTransforms(authored: string) {
  const rest = authored === 'none' ? '' : authored;
  return [`${rest} translateY(10px) scale(0.96)`, `${rest} translateY(0px) scale(1)`];
}

interface Targets {
  /** First child of each ReactFlow node wrapper: the wrapper's own transform positions the node. */
  nodes: HTMLElement[];
  edges: HTMLElement | null;
  edgePaths: SVGPathElement[];
  edgeLabels: HTMLElement | null;
  topbar: HTMLElement | null;
  bottom: HTMLElement | null;
  dock: HTMLElement | null;
}

function collect(root: HTMLElement): Targets {
  return {
    nodes: Array.from(root.querySelectorAll<HTMLElement>('.react-flow__node > :first-child')),
    edges: root.querySelector<HTMLElement>('.react-flow__edges'),
    edgePaths: Array.from(root.querySelectorAll<SVGPathElement>('.react-flow__edge')).flatMap(edge => {
      // The traffic renderer paints over BaseEdge. Draw the visible baseline, never its moving bands/packets.
      const traffic = edge.querySelector<SVGPathElement>('[data-cells-lanes-connection] > path:not([data-traffic-band]):not([data-traffic-marker])');
      const baseline = traffic ?? edge.querySelector<SVGPathElement>('.react-flow__edge-path');
      return baseline ? [baseline] : [];
    }),
    edgeLabels: root.querySelector<HTMLElement>('.react-flow__edgelabel-renderer'),
    topbar: root.querySelector<HTMLElement>('[data-testid="workspace-topbar"]'),
    bottom: root.querySelector<HTMLElement>('[data-testid="playback-panel"]'),
    dock: root.querySelector<HTMLElement>('[data-testid="canvas-floating-dock"]'),
  };
}

const originalStyles = new WeakMap<HTMLElement, { opacity: string; transform: string; filter: string }>();
function save(el: HTMLElement) {
  if (!originalStyles.has(el)) originalStyles.set(el, { opacity: el.style.opacity, transform: el.style.transform, filter: el.style.filter });
}
function translated(el: HTMLElement, y: number) {
  const authored = originalStyles.get(el)?.transform || getComputedStyle(el).transform;
  const rest = authored === 'none' ? '' : authored;
  return [`${rest} translateY(${y}px)`, `${rest} translateY(0px)`];
}
function clear(els: HTMLElement[]) {
  els.forEach((el) => {
    const saved = originalStyles.get(el);
    if (!saved) return;
    Object.assign(el.style, saved);
    originalStyles.delete(el);
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
export function runCanvasEnter(root: HTMLElement, onReady: () => void, coarse = false): () => void {
  let frame = 0;
  let tries = 0;
  let stopped = false;
  const controls: { stop(): void }[] = [];
  let hidden: HTMLElement[] = [];
  const drawn: DrawnEdge[] = [];
  const drawnPaths = new Set<SVGPathElement>();
  let observer: MutationObserver | null = null;
  let observerTimer = 0;
  let startedAt = 0;
  const shownNodes = new Set<HTMLElement>();
  const shownBars = new Set<HTMLElement>();
  const remaining = (delay: number) => Math.max(0, delay - (performance.now() - startedAt) / 1000);

  const start = () => {
    const t = collect(root);
    startedAt = performance.now();
    hidden = [...t.nodes, t.edgeLabels, t.topbar, t.bottom, t.dock].filter((el): el is HTMLElement => !!el);
    hidden.forEach((el) => {
      save(el);
      el.style.opacity = '0';
    });

    const canvas = root.querySelector<HTMLElement>('[data-canvas-node-count]');
    const nodeCount = Number(canvas?.dataset.canvasNodeCount ?? t.nodes.length);
    const edgeCount = Number(canvas?.dataset.canvasEdgeCount ?? root.querySelectorAll('.react-flow__edge').length);
    const { nodeStep, barDelay } = canvasEnterDelays(nodeCount, edgeCount);
    const gap = CARD.enterGap;
    const blur = !coarse && nodeCount <= CANVAS.maxBlurNodes;

    function revealNodes(nodes: HTMLElement[]) {
      nodes.forEach((node) => {
        if (shownNodes.has(node)) return;
        shownNodes.add(node);
        save(node);
        if (!hidden.includes(node)) hidden.push(node);
        node.style.opacity = '0';
        const authored = originalStyles.get(node)?.transform || getComputedStyle(node).transform;
        // Explicit identity values keep Motion's string interpolation from treating `none` as scale(0).
        const keyframes = { opacity: [0, 1], transform: canvasNodeTransforms(authored), ...(blur ? { filter: ['blur(6px)', 'blur(0px)'] } : {}) };
        const c = animate(node, keyframes, {
          duration: CANVAS.nodeDuration,
          delay: remaining(gap + (shownNodes.size - 1) * nodeStep),
          ease: EASE.enter,
        });
        controls.push(c);
        void c.then(() => clear([node]));
      });
    }
    revealNodes(t.nodes);
    // ReactFlow renders edges after it has measured nodes, so some arrive after this point:
    // prepare them in the same task (before paint) and draw them with the same stagger.
    const drawEdge = (path: SVGPathElement) => {
      if (drawnPaths.has(path)) return;
      drawnPaths.add(path);
      const edge = prepareEdge(path);
      drawn.push(edge);
      const underlying = path.closest('.react-flow__edge')?.querySelector<SVGPathElement>('.react-flow__edge-path');
      const base = underlying && underlying !== path ? prepareEdge(underlying) : null;
      if (base) drawn.push(base);
      const c = animateValue(edge.length, 0, {
        duration: CANVAS.edgeDuration,
        delay: remaining(gap + canvasEdgeDelay(drawnPaths.size - 1)),
        ease: EASE.inOut,
        onUpdate: (value) => {
          edge.path.style.strokeDashoffset = String(value);
          if (base) base.path.style.strokeDashoffset = String(value / edge.length * base.length);
        },
      });
      controls.push(c);
      void c.then(() => { restoreEdge(edge); if (base) restoreEdge(base); });
    };
    t.edgePaths.forEach(drawEdge);
    // Prepare every existing path before lifting the CSS first-paint guard.
    root.removeAttribute(ENTERING_ATTR);
    onReady();
    observer = new MutationObserver(() => {
      const late = collect(root);
      late.edgePaths.forEach(drawEdge);
      revealNodes(late.nodes);
      revealBars(late);
    });
    observer.observe(root, { childList: true, subtree: true });
    observerTimer = window.setTimeout(() => observer?.disconnect(), (gap + barDelay + CANVAS.barDuration + 1) * 1000);
    if (t.edgeLabels) {
      const c = animate(t.edgeLabels, { opacity: [0, 1] }, { duration: 0.4, delay: gap + canvasEdgeDelay(4) + CANVAS.edgeDuration, ease: EASE.enter });
      controls.push(c);
      void c.then(() => clear([t.edgeLabels!]));
    }
    function revealBars(targets: Targets) {
    for (const [bar, dir] of [[targets.topbar, -1], [targets.bottom, 1], [targets.dock, 1]] as const) {
      if (!bar || shownBars.has(bar)) continue;
      shownBars.add(bar);
      save(bar);
      if (!hidden.includes(bar)) hidden.push(bar);
      bar.style.opacity = '0';
      const c = animate(bar, { opacity: [0, 1], transform: translated(bar, dir * CANVAS.barOffset) }, { duration: CANVAS.barDuration, delay: remaining(gap + barDelay), ease: EASE.enter });
      controls.push(c);
      void c.then(() => clear([bar]));
      // Stagger semantic controls, excluding portal content and duplicate nested targets.
      const items = Array.from(bar.querySelectorAll<HTMLElement>('button, input, [role="slider"], [data-testid="breadcrumb-chip"], [data-testid="brand"]')).filter(item => !item.parentElement?.closest('button, [data-testid="breadcrumb-chip"]'));
      items.forEach((item, i) => {
        save(item);
        hidden.push(item);
        item.style.opacity = '0';
        const run = animate(item, { opacity: [0, 1], transform: translated(item, dir * 6), ...(!coarse ? { filter: ['blur(3px)', 'blur(0px)'] } : {}) }, { duration: .55, delay: remaining(gap + barDelay + .26 + i * .06), ease: EASE.enter });
        controls.push(run);
        void run.then(() => clear([item]));
      });
    }
    }
    revealBars(t);
  };

  const wait = () => {
    if (stopped) return;
    const canvas = root.querySelector<HTMLElement>('[data-canvas-node-count]');
    const emptyCanvas = canvas?.dataset.canvasNodeCount === '0';
    if (root.querySelector('.react-flow__node, [data-testid="empty-views-state"]') || emptyCanvas || tries++ > 60) {
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
export function runCanvasExit(root: HTMLElement, coarse = false): { done: Promise<void>; stop: () => void } {
  const t = collect(root);
  const runs: { stop(): void; then(onResolve: () => void, onReject?: () => void): Promise<void> }[] = [];
  const touched: HTMLElement[] = [];
  const track = <T extends { stop(): void; then(onResolve: () => void, onReject?: () => void): Promise<void> }>(el: HTMLElement | HTMLElement[], run: T) => {
    touched.push(...(Array.isArray(el) ? el : [el]));
    runs.push(run);
  };
  [...t.nodes, t.edges, t.edgeLabels, t.topbar, t.bottom, t.dock].forEach(el => { if (el) save(el); });
  if (t.topbar) track(t.topbar, animate(t.topbar, { opacity: 0, transform: translated(t.topbar, -CANVAS.barOffset)[0] }, { duration: CANVAS.exitBar, ease: EASE.exit }));
  if (t.bottom) track(t.bottom, animate(t.bottom, { opacity: 0, transform: translated(t.bottom, CANVAS.barOffset)[0] }, { duration: CANVAS.exitBar, ease: EASE.exit }));
  if (t.dock) track(t.dock, animate(t.dock, { opacity: 0, transform: translated(t.dock, CANVAS.barOffset)[0] }, { duration: CANVAS.exitBar, ease: EASE.exit }));
  if (t.nodes.length) {
    track(
      t.nodes,
      animate(
        t.nodes,
        { opacity: 0, ...(!coarse ? { filter: 'blur(6px)' } : {}) },
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
