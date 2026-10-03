import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import type { Document, Element, Connection, Port, Refinement } from './model';
import { computeClosure } from './closure';

function loadFixture(filename: string): Document {
  const filePath = path.resolve(__dirname, '../../../specs/revamp/fixtures', filename);
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as Document;
}

function isSorted(arr: readonly string[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1] > arr[i]) return false;
  }
  return true;
}

describe('Scenario Scope Closure (computeClosure)', () => {
  describe('Reference Fixtures (S01 to S05)', () => {
    const fixtureNames = ['s01.json', 's02.json', 's03.json', 's04.json', 's05.json'];

    for (const name of fixtureNames) {
      it(`evaluates all scenarios in ${name} with status 'ok'`, () => {
        const doc = loadFixture(name);
        expect(doc.scenarios.length).toBeGreaterThan(0);

        for (const scenario of doc.scenarios) {
          const res = computeClosure(doc, scenario.id);

          if (res.status !== 'ok') {
            // If any fixture scenario does not return 'ok', fail with full details
            expect(res).toEqual(
              expect.objectContaining({
                status: 'ok',
              }),
            );
            return;
          }

          expect(res.status).toBe('ok');

          // Verify all array properties are sorted
          expect(isSorted(res.declaredScope)).toBe(true);
          expect(isSorted(res.includedElementIds)).toBe(true);
          expect(isSorted(res.includedConnectionIds)).toBe(true);
          expect(isSorted(res.boundaryIds)).toBe(true);
          expect(isSorted(res.excludedElementIds)).toBe(true);
          expect(isSorted(res.schemaIds)).toBe(true);
          expect(isSorted(res.fixtureIds)).toBe(true);
          expect(isSorted(res.structuralRelationIds)).toBe(true);

          // Verify includedElementIds and excludedElementIds are disjoint
          const includedSet = new Set(res.includedElementIds);
          for (const exc of res.excludedElementIds) {
            expect(includedSet.has(exc)).toBe(false);
          }

          // Verify all declaredScope elements are classified as either included or excluded
          for (const decl of res.declaredScope) {
            const inIncluded = includedSet.has(decl);
            const inExcluded = res.excludedElementIds.includes(decl);
            expect(inIncluded || inExcluded).toBe(true);
          }
        }
      });
    }
  });

  describe('Determinism', () => {
    it('produces identical results regardless of document array ordering', () => {
      const doc = loadFixture('s05.json');
      const scenarioId = doc.scenarios[0].id;

      const baseline = computeClosure(doc, scenarioId);
      expect(baseline.status).toBe('ok');

      // Shuffle helper with pseudo-random deterministic seed
      function shuffle<T>(arr: readonly T[], seed: number): T[] {
        const copy = [...arr];
        let s = seed;
        for (let i = copy.length - 1; i > 0; i--) {
          s = (s * 9301 + 49297) % 233280;
          const j = Math.floor((s / 233280) * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      for (let run = 1; run <= 5; run++) {
        const shuffledDoc: Document = {
          ...doc,
          elements: shuffle(doc.elements, run * 13),
          connections: shuffle(doc.connections, run * 17),
          relations: shuffle(doc.relations, run * 19),
          schemas: shuffle(doc.schemas, run * 23),
          fixtures: shuffle(doc.fixtures, run * 29),
          refinements: shuffle(doc.refinements, run * 31),
          scenarios: shuffle(doc.scenarios, run * 37),
        };

        const result = computeClosure(shuffledDoc, scenarioId);
        expect(result).toEqual(baseline);
      }
    });
  });

  describe('Crossings and Boundaries', () => {
    it('returns unresolved-crossing when a crossing connection has no matching boundary', () => {
      const doc = loadFixture('s01.json');
      const scenario = doc.scenarios[0];

      // Mutate by removing all boundaries
      const mutatedDoc: Document = {
        ...doc,
        scenarios: doc.scenarios.map((s) => (s.id === scenario.id ? { ...s, boundaries: [] } : s)),
      };

      const res = computeClosure(mutatedDoc, scenario.id);
      expect(res.status).toBe('not-ready');
      if (res.status === 'not-ready') {
        expect(res.issues.some((i) => i.code === 'unresolved-crossing')).toBe(true);
      }
    });
  });

  describe('Recursive Refinement', () => {
    it('rejects direct recursive ownership cycle before expansion', () => {
      const doc = loadFixture('s01.json');
      const scenario = doc.scenarios[0];

      const recursiveRefinements: Refinement[] = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          ownerElementId: '04f1d18c-7a82-5986-aae6-ca2fe393b135', // Checkout
          memberElementIds: ['22222222-2222-4222-8222-222222222222'],
          portMappings: [],
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          ownerElementId: '22222222-2222-4222-8222-222222222222',
          memberElementIds: ['04f1d18c-7a82-5986-aae6-ca2fe393b135'], // cycle back to Checkout
          portMappings: [],
        },
      ];

      const mutatedDoc: Document = {
        ...doc,
        refinements: recursiveRefinements,
      };

      const res = computeClosure(mutatedDoc, scenario.id);
      expect(res.status).toBe('not-ready');
      if (res.status === 'not-ready') {
        expect(res.issues.some((i) => i.code === 'recursive-refinement')).toBe(true);
      }
    });

    it('rejects self-referential refinement before expansion', () => {
      const doc = loadFixture('s01.json');
      const scenario = doc.scenarios[0];

      const selfRefinements: Refinement[] = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          ownerElementId: '04f1d18c-7a82-5986-aae6-ca2fe393b135',
          memberElementIds: ['04f1d18c-7a82-5986-aae6-ca2fe393b135'], // self-referential
          portMappings: [],
        },
      ];

      const mutatedDoc: Document = {
        ...doc,
        refinements: selfRefinements,
      };

      const res = computeClosure(mutatedDoc, scenario.id);
      expect(res.status).toBe('not-ready');
      if (res.status === 'not-ready') {
        expect(res.issues.some((i) => i.code === 'recursive-refinement')).toBe(true);
      }
    });
  });

  describe('Declared Scope and Unreached Elements', () => {
    it('places unreachable elements declared in scope into excludedElementIds', () => {
      const doc = loadFixture('s02.json');
      const scenario = doc.scenarios[0];

      const unreachableId = '99999999-9999-4999-8999-999999999999';
      const unreachableElement: Element = {
        id: unreachableId,
        label: 'Unreachable Service',
        description: 'Never connected',
        visualKind: 'service',
        ports: [],
        behavior: { kind: 'unmodeled', version: 1, reason: 'Stub' },
      };

      const mutatedDoc: Document = {
        ...doc,
        elements: [...doc.elements, unreachableElement],
        scenarios: doc.scenarios.map((s) =>
          s.id === scenario.id ? { ...s, scopeElementIds: [...s.scopeElementIds, unreachableId] } : s,
        ),
      };

      const res = computeClosure(mutatedDoc, scenario.id);
      expect(res.status).toBe('ok');
      if (res.status === 'ok') {
        expect(res.includedElementIds.includes(unreachableId)).toBe(false);
        expect(res.excludedElementIds.includes(unreachableId)).toBe(true);
        expect(res.declaredScope.includes(unreachableId)).toBe(true);
      }
    });
  });

  describe('Limits and Cancellation', () => {
    it('returns analysis-limit when exceeding 2,000 expanded entities', () => {
      // Build a chain of 2,005 elements connected end-to-end
      const count = 2005;
      const elements: Element[] = [];
      const connections: Connection[] = [];
      const scopeIds: string[] = [];

      const schemaId = '10000000-0000-4000-8000-000000000000';
      const makeId = (prefix: string, i: number) => {
        const hex = i.toString(16).padStart(12, '0');
        return `${prefix}-0000-4000-8000-${hex}`;
      };

      for (let i = 0; i < count; i++) {
        const elId = makeId('aaaaaaaa', i);
        const inPortId = makeId('bbbbbbbb', i);
        const outPortId = makeId('cccccccc', i);

        scopeIds.push(elId);

        const ports: Port[] = [
          { id: inPortId, label: 'in', direction: 'in', channel: 'message', protocol: 'amqp', schemaId, responseSchemaId: null },
          { id: outPortId, label: 'out', direction: 'out', channel: 'message', protocol: 'amqp', schemaId, responseSchemaId: null },
        ];

        elements.push({
          id: elId,
          label: `Node ${i}`,
          description: '',
          visualKind: 'service',
          ports,
          behavior: {
            kind: 'resource',
            version: 1,
            entryPortId: inPortId,
            config: {
              type: 'processor',
              capacity: 100,
              concurrency: 1,
              queueLimit: 10,
              failureRate: 0,
              maxRetries: 0,
              retryDelayMs: 0,
            },
          },
        });

        if (i > 0) {
          const prevOutPortId = makeId('cccccccc', i - 1);
          const prevElId = makeId('aaaaaaaa', i - 1);
          connections.push({
            id: makeId('dddddddd', i),
            kind: 'message',
            source: { elementId: prevElId, portId: prevOutPortId },
            target: { elementId: elId, portId: inPortId },
            config: {
              latencyMs: 0,
              linkClass: null,
              weight: 1,
              condition: null,
              fallback: false,
              },
          });
        }
      }

      const scenarioId = 'eeeeeeee-0000-4000-8000-000000000000';
      const entryPort = { elementId: elements[0].id, portId: elements[0].ports[0].id };

      const syntheticDoc: Document = {
        schema: 'studio-model/1',
        id: 'ffffffff-0000-4000-8000-000000000000',
        title: 'Deep synthetic document',
        elements,
        connections,
        relations: [],
        schemas: [
          {
            id: schemaId,
            label: 'Msg',
            shape: { type: 'string', nullable: false },
          },
        ],
        fixtures: [],
        refinements: [],
        scenarios: [
          {
            id: scenarioId,
            label: 'Traverse deep chain',
            revision: 1,
            mode: 'logical',
            scopeElementIds: scopeIds,
            entryPorts: [entryPort],
            inputs: [
              {
                id: '12345678-0000-4000-8000-000000000000',
                entry: entryPort,
                fixtureId: '23456789-0000-4000-8000-000000000000',
                journeyId: '34567890-0000-4000-8000-000000000000',
                atMs: null,
                payloadBindings: [],
                resource: null,
              },
            ],
            workloads: [],
            faults: [],
            boundaries: [],
            refinementSelections: [],
            initialContexts: [],
            assertions: [],
            seed: 1,
            budgets: {
              maxEvents: 1000,
              maxTraceRows: 1000,
              maxTraceBytes: 10000,
              maxScheduledEvents: 100,
              maxLiveRoots: 100,
            },
            completion: { kind: 'quiescent' },
            assumptions: [],
          },
        ],
        views: [],
      };

      const res = computeClosure(syntheticDoc, scenarioId);
      expect(res.status).toBe('analysis-limit');
    });

    it('returns cancelled when shouldCancel returns true immediately', () => {
      const doc = loadFixture('s05.json');
      const scenarioId = doc.scenarios[0].id;

      const resEarly = computeClosure(doc, scenarioId, { shouldCancel: () => true });
      expect(resEarly.status).toBe('cancelled');
    });

    it('returns cancelled when shouldCancel flips true during batch processing (not just the initial check)', () => {
      const doc = loadFixture('s05.json');
      const scenarioId = doc.scenarios[0].id;

      // Sanity: confirm the baseline actually completes 'ok' so a later 'cancelled'
      // result proves the mid-traversal check fired, not just the pre-flight check.
      const baseline = computeClosure(doc, scenarioId);
      expect(baseline.status).toBe('ok');

      // First call is the pre-flight check (before any expansion); return false there
      // so traversal proceeds, then flip true so cancellation must come from the
      // batch-boundary check inside/after the work-queue loop (storage.md §6).
      let callCount = 0;
      const resBatched = computeClosure(doc, scenarioId, {
        shouldCancel: () => {
          callCount++;
          return callCount >= 2;
        },
      });
      expect(resBatched.status).toBe('cancelled');
      expect(callCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Refinements (S05 aggregate vs refined)', () => {
    it('changes includedElementIds when changing selection between aggregate and refined', () => {
      const doc = loadFixture('s05.json');
      const scenario = doc.scenarios[0];

      // In S05:
      // Worker: '7453e0ab-17a6-579d-909c-0586d9144ad3'
      // Entry port of worker: '7032193c-b741-5f40-83ec-5e24cdcd072d'
      const workerId = '7453e0ab-17a6-579d-909c-0586d9144ad3';
      const workerInPortId = '7032193c-b741-5f40-83ec-5e24cdcd072d';

      // Define a member element representing a refined implementation of the worker
      const memberId = 'aaaaaaaa-1111-4111-8111-111111111111';
      const memberInPortId = 'bbbbbbbb-2222-4222-8222-222222222222';
      const memberElement: Element = {
        id: memberId,
        label: 'Worker Implementation',
        description: 'Internal refined worker',
        visualKind: 'service',
        ports: [
          {
            id: memberInPortId,
            label: 'entry',
            direction: 'in',
            channel: 'call', protocol: 'http',
            schemaId: '82d08a0e-9949-5da7-92c9-bea29d236999', // Order schema
            responseSchemaId: '82d08a0e-9949-5da7-92c9-bea29d236999',
          },
        ],
        behavior: {
          kind: 'resource',
          version: 1,
          entryPortId: memberInPortId,
          config: {
            type: 'processor',
            capacity: 50,
            concurrency: 1,
            queueLimit: 10,
            failureRate: 0,
            maxRetries: 0,
            retryDelayMs: 0,
          },
        },
      };

      const refinementId = 'cccccccc-3333-4333-8333-333333333333';
      const refinement: Refinement = {
        id: refinementId,
        ownerElementId: workerId,
        memberElementIds: [memberId],
        portMappings: [
          {
            id: 'dddddddd-4444-4444-8444-444444444444',
            outer: { elementId: workerId, portId: workerInPortId },
            inner: { elementId: memberId, portId: memberInPortId },
          },
        ],
      };

      // Add refinement and member element to document
      const docWithRefinement: Document = {
        ...doc,
        elements: [...doc.elements, memberElement],
        refinements: [refinement],
      };

      // Test Mode 1: Aggregate (keeps owner, excludes member)
      const docAggregate: Document = {
        ...docWithRefinement,
        scenarios: docWithRefinement.scenarios.map((s) =>
          s.id === scenario.id
            ? {
                ...s,
                refinementSelections: [{ refinementId, mode: 'aggregate' }],
              }
            : s,
        ),
      };

      const resAggregate = computeClosure(docAggregate, scenario.id);
      expect(resAggregate.status).toBe('ok');
      if (resAggregate.status === 'ok') {
        expect(resAggregate.includedElementIds.includes(workerId)).toBe(true);
        expect(resAggregate.includedElementIds.includes(memberId)).toBe(false);
        expect(resAggregate.excludedElementIds.includes(memberId)).toBe(true);
      }

      // Test Mode 2: Refined (excludes owner, routes through portMappings to include member)
      const docRefined: Document = {
        ...docWithRefinement,
        scenarios: docWithRefinement.scenarios.map((s) =>
          s.id === scenario.id
            ? {
                ...s,
                scopeElementIds: [...s.scopeElementIds, memberId],
                refinementSelections: [{ refinementId, mode: 'refined' }],
              }
            : s,
        ),
      };

      const resRefined = computeClosure(docRefined, scenario.id);
      expect(resRefined.status).toBe('ok');
      if (resRefined.status === 'ok') {
        expect(resRefined.includedElementIds.includes(workerId)).toBe(false);
        expect(resRefined.includedElementIds.includes(memberId)).toBe(true);
        expect(resRefined.excludedElementIds.includes(workerId)).toBe(true);
      }

      // Confirm that the sets of includedElementIds are different
      if (resAggregate.status === 'ok' && resRefined.status === 'ok') {
        expect(resAggregate.includedElementIds).not.toEqual(resRefined.includedElementIds);
      }

      const nestedMemberId = 'eeeeeeee-5555-4555-8555-555555555555';
      const nestedMemberPortId = 'ffffffff-6666-4666-8666-666666666666';
      const nestedMemberElement: Element = {
        ...memberElement,
        id: nestedMemberId,
        label: 'Nested worker implementation',
        ports: [{ ...memberElement.ports[0], id: nestedMemberPortId }],
        behavior: {
          kind: 'resource',
          version: 1,
          entryPortId: nestedMemberPortId,
          config: {
            type: 'processor',
            capacity: 50,
            concurrency: 1,
            queueLimit: 10,
            failureRate: 0,
            maxRetries: 0,
            retryDelayMs: 0,
          },
        },
      };
      const nestedRefinementId = '11111111-7777-4777-8777-777777777777';
      const nestedRefinement: Refinement = {
        id: nestedRefinementId,
        ownerElementId: memberId,
        memberElementIds: [nestedMemberId],
        portMappings: [
          {
            id: '22222222-8888-4888-8888-888888888888',
            outer: { elementId: memberId, portId: memberInPortId },
            inner: { elementId: nestedMemberId, portId: nestedMemberPortId },
          },
        ],
      };
      const inertNestedSelection: Document = {
        ...docWithRefinement,
        elements: [...docWithRefinement.elements, nestedMemberElement],
        refinements: [refinement, nestedRefinement],
        scenarios: docWithRefinement.scenarios.map((candidate) =>
          candidate.id === scenario.id
            ? {
                ...candidate,
                scopeElementIds: [...candidate.scopeElementIds, memberId, nestedMemberId],
                refinementSelections: [
                  { refinementId, mode: 'aggregate' },
                  { refinementId: nestedRefinementId, mode: 'refined' },
                ],
              }
            : candidate,
        ),
      };

      const inertResult = computeClosure(inertNestedSelection, scenario.id);
      expect(inertResult.status).toBe('ok');
      if (inertResult.status === 'ok') {
        expect(inertResult.includedElementIds).toContain(workerId);
        expect(inertResult.includedElementIds).not.toContain(memberId);
        expect(inertResult.includedElementIds).not.toContain(nestedMemberId);
        expect(inertResult.excludedElementIds).toEqual(
          expect.arrayContaining([memberId, nestedMemberId]),
        );
      }
    });
  });

  describe('Structural Constraints and Faults', () => {
    it('reports missing-target when a scenario fault targets a host that is not included', () => {
      const doc = loadFixture('s04.json');
      const scenario = doc.scenarios[0]; // Failover routing scenario

      const missingHostId = 'ffffffff-9999-4999-8999-999999999999';
      const mutatedDoc: Document = {
        ...doc,
        scenarios: doc.scenarios.map((s) =>
          s.id === scenario.id
            ? {
                ...s,
                faults: [{ ...s.faults[0], hostId: missingHostId }],
              }
            : s,
        ),
      };

      const res = computeClosure(mutatedDoc, scenario.id);
      expect(res.status).toBe('not-ready');
      if (res.status === 'not-ready') {
        expect(res.issues.some((i) => i.code === 'missing-target')).toBe(true);
      }
    });
  });
});
