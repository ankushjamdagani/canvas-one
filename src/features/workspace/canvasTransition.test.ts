import { describe, expect, it } from 'vitest';
import { canvasEdgeDelay, canvasEnterDelays } from './canvasTransition';

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

describe('canvasEdgeDelay', () => {
  it('staggers edge drawing 140 ms apart after the 260 ms edge start, capped at four steps', () => {
    expect(canvasEdgeDelay(0)).toBeCloseTo(0.26, 5);
    expect(canvasEdgeDelay(2)).toBeCloseTo(0.26 + 0.28, 5);
    expect(canvasEdgeDelay(9)).toBeCloseTo(0.26 + 0.56, 5);
  });
});
