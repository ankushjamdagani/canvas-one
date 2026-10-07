import { describe, expect, it } from 'vitest';
import { canvasEdgeDelay, canvasEnterDelays, canvasNodeTransforms } from './canvasTransition';

describe('canvasNodeTransforms', () => {
  it('ends untransformed nodes at an explicit full-size scale', () => {
    expect(canvasNodeTransforms('none')[1]).toContain('scale(1)');
    expect(canvasNodeTransforms('none')[1]).not.toContain('none');
  });

  it('composes entrance motion with authored node transforms', () => {
    const frames = canvasNodeTransforms('rotate(4deg)');
    expect(frames.every(frame => frame.startsWith('rotate(4deg)'))).toBe(true);
    expect(frames[1]).toContain('translateY(0px) scale(1)');
  });
});

describe('canvasEnterDelays', () => {
  it('uses the showcase 110 ms node stagger for small canvases', () => {
    expect(canvasEnterDelays(4, 3).nodeStep).toBeCloseTo(0.11, 5);
  });

  it('shrinks the stagger so a busy canvas finishes entering within the budget', () => {
    const { nodeStep } = canvasEnterDelays(40, 0);
    expect(nodeStep * 40).toBeCloseTo(1.2, 5);
  });

  it('starts bars after all reference edges, bounding the stagger on large graphs', () => {
    expect(canvasEnterDelays(3, 3).barDelay).toBeCloseTo(0.26 + 3 * 0.14 + 0.52, 5);
    expect(canvasEnterDelays(3, 6).barDelay).toBeCloseTo(0.26 + 6 * 0.14 + 0.52, 5);
    expect(canvasEnterDelays(3, 99).barDelay).toBeCloseTo(0.26 + 8 * 0.14 + 0.52, 5);
  });
});

describe('canvasEdgeDelay', () => {
  it('staggers edge drawing 140 ms apart after the 260 ms edge start, bounded for large graphs', () => {
    expect(canvasEdgeDelay(0)).toBeCloseTo(0.26, 5);
    expect(canvasEdgeDelay(2)).toBeCloseTo(0.26 + 0.28, 5);
    expect(canvasEdgeDelay(5)).toBeCloseTo(0.26 + 0.7, 5);
    expect(canvasEdgeDelay(99)).toBeCloseTo(0.26 + 1.12, 5);
  });
});
