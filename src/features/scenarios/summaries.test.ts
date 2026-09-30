import { describe, expect, it } from 'vitest';
import { summarizeWorkloadMix, summarizeFault, summarizeAssertion, summarizeStep, summarizeBoundary } from './summaries';
import type { DraftRequestClass, DraftAssertion } from './draftScenario';
import type { Document, Fault, Input, Boundary } from '../../domain/studio/model';

const emptyDoc: Document = {
  elements: [
    { id: 'h1', label: 'H1', ports: [{ id: 'p1', label: 'p1', kind: 'in' as const }], behavior: { kind: 'host' }, layout: { bounds: { x: 0, y: 0, w: 100, h: 100 } } }
  ],
  connections: [],
  layouts: {}
} as unknown as Document;

describe('summaries', () => {
  it('summarizes workload mix', () => {
    const classes: DraftRequestClass[] = [
      { id: '1', name: 'browse', weight: 80, operation: 'read', tags: [], keyDistribution: { kind: null, catalogSize: null, hotSubset: null, hotShare: null } },
      { id: '2', name: 'checkout', weight: 20, operation: 'write', tags: [], keyDistribution: { kind: null, catalogSize: null, hotSubset: null, hotShare: null } },
      { id: '3', name: 'edit', weight: 0, operation: 'write', tags: [], keyDistribution: { kind: null, catalogSize: null, hotSubset: null, hotShare: null } }
    ];
    expect(summarizeWorkloadMix(classes)).toBe('browse 80% read · checkout 20% write · edit 0% write');
  });

  it('summarizes fault', () => {
    const fault: Fault = {
      id: 'f1', hostId: 'h1', downAtMs: 2000, upAtMs: 4000, detectionDelayMs: 1000,
      recoveryDetectionDelayMs: 0, activePolicy: 'fail', queuedPolicy: 'reject', routeReset: 'first-healthy'
    };
    expect(summarizeFault(fault, emptyDoc)).toBe('H1 · down 2.0 s → up 4.0 s · noticed after 1.0 s');
  });

  it('summarizes assertion', () => {
    const assertion: DraftAssertion = {
      id: 'a1', label: 'My check', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' },
      operator: 'at-most', expected: 0
    };
    expect(summarizeAssertion(assertion, emptyDoc)).toBe('root count · at most 0');
  });

  it('summarizes step', () => {
    const input: Input = {
      id: 'i1', entry: { elementId: 'h1', portId: 'p1' }, fixtureId: 'f1', journeyId: 'j1',
      atMs: null, payloadBindings: [], resource: null
    };
    expect(summarizeStep(input, 0, emptyDoc)).toBe('step 1 · H1 · p1 · at start');
  });

  it('summarizes boundary', () => {
    const boundary: Boundary = {
      id: 'b1', source: { elementId: 'h1', portId: 'p1' }, schemaId: 's1', responses: []
    };
    expect(summarizeBoundary(boundary, emptyDoc)).toBe('H1 · p1 · 0 replies');
  });
});
