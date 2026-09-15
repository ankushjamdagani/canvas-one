import { it, expect } from 'vitest';
import { defaultBehavior, defaultExecutionEdge, defaultWorkload } from '../../domain/behaviorDefaults';
import type { ExecutionGraph } from '../../domain/execution';
import { OpenSimulation } from './kernel';

it('stops a large fan-out at the live-operation bound without discarding outcomes', () => {
  const graph: ExecutionGraph = {
    executionVersion: 'open-system/1', settings: { seed: 42, duration: 2 },
    nodes: Array.from({ length: 100 }, (_, i) => ({
      id: `n${i}`, kind: i === 0 ? 'traffic' : 'service', name: `Node ${i}`,
      position: { x: i, y: 0 },
      behavior: { ...defaultBehavior(i === 0 ? 'traffic' : 'service'), capacity: 1, queueLimit: 10000 },
    })),
    edges: Array.from({ length: 99 }, (_, i) => ({ ...defaultExecutionEdge('n0', `n${i + 1}`), id: `e${i}` })),
    workloads: [{ ...defaultWorkload('n0'), id: 'load', intervalMs: 1, timeoutMs: 5000 }],
  };
  const sim = new OpenSimulation(graph);
  const m = sim.advance(2);
  expect(m.incomplete).toBe('resource limit');
  expect(m.finished).toBe(false);
  expect(m.time).toBeLessThan(2);
  expect(m.roots.generated).toBe(m.roots.succeeded + m.roots.rejected + m.roots.failed + m.roots.expired + m.roots.inFlight);
  expect(sim.advance(2)).toEqual(m);
});
