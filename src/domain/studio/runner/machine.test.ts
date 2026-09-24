import { describe, it, expect } from 'vitest';
import { stepMachine, validatePayloadShape } from './machine';
import type { MachineBehavior, Shape } from '../model';

describe('machine: validatePayloadShape', () => {
  const scalarShape: Shape = { type: 'string', nullable: false };
  const nullableShape: Shape = { type: 'string', nullable: true };
  const recordShape: Shape = {
    type: 'record',
    nullable: false,
    fields: [
      { id: 'f1', key: 'reqId', optional: false, shape: { type: 'string', nullable: false } },
      { id: 'f2', key: 'opt', optional: true, shape: { type: 'integer', nullable: false } },
    ],
  };

  it('validates scalar and nullable shapes', () => {
    expect(validatePayloadShape('test', scalarShape)).toEqual({ ok: true });
    expect(validatePayloadShape(123, scalarShape).ok).toBe(false);
    expect(validatePayloadShape(null, scalarShape).ok).toBe(false);
    expect(validatePayloadShape(null, nullableShape)).toEqual({ ok: true });
  });

  it('validates record shapes and rejects unknown fields', () => {
    expect(validatePayloadShape({ reqId: '123' }, recordShape)).toEqual({ ok: true });
    expect(validatePayloadShape({ reqId: '123', opt: 4 }, recordShape)).toEqual({ ok: true });
    // Unknown field:
    expect(validatePayloadShape({ reqId: '123', extra: true }, recordShape).ok).toBe(false);
    // Missing required field:
    expect(validatePayloadShape({}, recordShape).ok).toBe(false);
  });
});

describe('machine: stepMachine', () => {
  const stateA = 'state-a';
  const stateB = 'state-b';
  const stateC = 'state-c';
  const portIn = 'port-in';
  const portOut = 'port-out';

  const sampleMachine: MachineBehavior = {
    kind: 'machine',
    version: 1,
    states: [
      { id: stateA, label: 'State A' },
      { id: stateB, label: 'State B' },
      { id: stateC, label: 'State C' },
    ],
    initialStateId: stateA,
    contextSchemaId: 'schema-ctx',
    initialContextFixtureId: 'fixture-init',
    transitions: [
      // Transition 1: matched if input.tag === 't1'
      {
        id: 'trans-1',
        fromStateId: stateA,
        eventPortId: portIn,
        guard: {
          op: 'equals',
          left: { kind: 'read', source: 'input', path: ['tag'] },
          right: { kind: 'literal', value: 't1' },
        },
        toStateId: stateB,
        effects: [
          { id: 'e1', kind: 'trace', code: 'trans-1-taken' },
          { id: 'e2', kind: 'assign', path: ['foo'], value: { kind: 'literal', value: 'bar' } },
        ],
      },
      // Transition 2: fallback from stateA on portIn
      {
        id: 'trans-2',
        fromStateId: stateA,
        eventPortId: portIn,
        guard: null,
        toStateId: stateC,
        effects: [{ id: 'e3', kind: 'trace', code: 'trans-2-fallback' }],
      },
    ],
    responseBindings: [],
  };

  it('first match wins: matches guarded transition when guard is true', () => {
    let counter = 0;
    const res = stepMachine({
      machine: sampleMachine,
      currentStateId: stateA,
      currentContext: { foo: 'initial' },
      eventPortId: portIn,
      payload: { tag: 't1' },
      rootId: 'root#0',
      nextRequestIdCounter: () => ++counter,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matched).toBe(true);
      expect(res.transitionId).toBe('trans-1');
      expect(res.toStateId).toBe(stateB);
      expect(res.context).toEqual({ foo: 'bar' });
      expect(res.traces).toEqual(['trans-1-taken']);
    }
  });

  it('first match wins: falls through to next matching transition when first guard fails', () => {
    let counter = 0;
    const res = stepMachine({
      machine: sampleMachine,
      currentStateId: stateA,
      currentContext: { foo: 'initial' },
      eventPortId: portIn,
      payload: { tag: 'other' },
      rootId: 'root#0',
      nextRequestIdCounter: () => ++counter,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matched).toBe(true);
      expect(res.transitionId).toBe('trans-2');
      expect(res.toStateId).toBe(stateC);
      expect(res.context).toEqual({ foo: 'initial' });
      expect(res.traces).toEqual(['trans-2-fallback']);
    }
  });

  it('no transition matching -> no change', () => {
    let counter = 0;
    const res = stepMachine({
      machine: sampleMachine,
      currentStateId: stateB, // no transitions from stateB
      currentContext: { foo: 'initial' },
      eventPortId: portIn,
      payload: { tag: 't1' },
      rootId: 'root#0',
      nextRequestIdCounter: () => ++counter,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matched).toBe(false);
      expect(res.toStateId).toBe(stateB);
      expect(res.context).toEqual({ foo: 'initial' });
      expect(res.emissions).toEqual([]);
      expect(res.traces).toEqual([]);
    }
  });

  it('atomic rollback on invalid effect: does not mutate context or advance state', () => {
    const machineWithBadEffect: MachineBehavior = {
      ...sampleMachine,
      transitions: [
        {
          id: 'trans-bad',
          fromStateId: stateA,
          eventPortId: portIn,
          guard: null,
          toStateId: stateB,
          effects: [
            // Valid effect first:
            { id: 'eff-1', kind: 'assign', path: ['temp'], value: { kind: 'literal', value: 'tempVal' } },
            // Then invalid effect: emit with context-request correlation where path does not exist
            {
              id: 'eff-2',
              kind: 'emit',
              portId: portOut,
              value: { kind: 'literal', value: { x: 1 } },
              correlation: { kind: 'context-request', path: ['nonExistentReqId'] },
            },
          ],
        },
      ],
    };

    const initialContext = Object.freeze({ foo: 'original' });
    let counter = 0;
    const res = stepMachine({
      machine: machineWithBadEffect,
      currentStateId: stateA,
      currentContext: initialContext,
      eventPortId: portIn,
      payload: {},
      rootId: 'root#0',
      nextRequestIdCounter: () => ++counter,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.stateId).toBe(stateA); // unchanged!
      expect(res.context).toEqual({ foo: 'original' }); // not mutated!
      expect(res.errorCode).toBe('invalid-context-correlation');
    }
  });

  it('double reply in single transition fails the run', () => {
    const machineWithDoubleReply: MachineBehavior = {
      ...sampleMachine,
      transitions: [
        {
          id: 'trans-double-reply',
          fromStateId: stateA,
          eventPortId: portIn,
          guard: null,
          toStateId: stateB,
          effects: [
            { id: 'r1', kind: 'reply', value: { kind: 'literal', value: 'first' }, outcome: 'succeeded' },
            { id: 'r2', kind: 'reply', value: { kind: 'literal', value: 'second' }, outcome: 'succeeded' },
          ],
        },
      ],
    };

    let counter = 0;
    const res = stepMachine({
      machine: machineWithDoubleReply,
      currentStateId: stateA,
      currentContext: {},
      eventPortId: portIn,
      payload: {},
      rootId: 'root#0',
      nextRequestIdCounter: () => ++counter,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe('double-reply');
      expect(res.stateId).toBe(stateA);
    }
  });

  it('request-id effect mints monotonic counter and schedule-event records timer trace', () => {
    const machineWithReqId: MachineBehavior = {
      ...sampleMachine,
      transitions: [
        {
          id: 'trans-req',
          fromStateId: stateA,
          eventPortId: portIn,
          guard: null,
          toStateId: stateB,
          effects: [
            { id: 'r1', kind: 'request-id', path: ['activeId'] },
            {
              id: 's1',
              kind: 'schedule-event',
              delayMs: 5000,
              eventPortId: portIn,
              value: { kind: 'literal', value: {} },
            },
            {
              id: 'e1',
              kind: 'emit',
              portId: portOut,
              value: { kind: 'read', source: 'context', path: ['activeId'] },
              correlation: { kind: 'context-request', path: ['activeId'] },
            },
          ],
        },
      ],
    };

    let counter = 0;
    const res = stepMachine({
      machine: machineWithReqId,
      currentStateId: stateA,
      currentContext: {},
      eventPortId: portIn,
      payload: {},
      rootId: 'root#1',
      nextRequestIdCounter: () => ++counter,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.context).toEqual({ activeId: 'root#1:1' });
      expect(res.traces).toContain('timer-awaits-explicit-input');
      expect(res.emissions.length).toBe(1);
      expect(res.emissions[0].correlationRequestId).toBe('root#1:1');
    }
  });
});
