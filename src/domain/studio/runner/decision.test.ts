import { describe, it, expect } from 'vitest';
import { runDecision } from './decision';
import type { Element, PayloadSchema } from '../model';

describe('decision interpreter (RV-14d-3)', () => {
  const schemas: PayloadSchema[] = [
    {
      id: 'schema-str',
      label: 'String',
      shape: {
        type: 'string',
        nullable: false,
      },
    },
    {
      id: 'schema-int',
      label: 'Integer',
      shape: {
        type: 'integer',
        nullable: false,
      },
    },
  ];

  const testDecisionElement: Element = {
    id: 'decision-1',
    label: 'Branch decision',
    description: '',
    visualKind: 'state-machine',
    ports: [
      {
        id: 'port-in',
        label: 'in',
        direction: 'in',
        channel: 'data', protocol: 'jdbc',
        schemaId: 'schema-str',
        responseSchemaId: null,
      },
      {
        id: 'port-out-case1',
        label: 'case1',
        direction: 'out',
        channel: 'data', protocol: 'jdbc',
        schemaId: 'schema-str',
        responseSchemaId: null,
      },
      {
        id: 'port-out-case2',
        label: 'case2',
        direction: 'out',
        channel: 'data', protocol: 'jdbc',
        schemaId: 'schema-str',
        responseSchemaId: null,
      },
      {
        id: 'port-out-fallback',
        label: 'fallback',
        direction: 'out',
        channel: 'data', protocol: 'jdbc',
        schemaId: 'schema-str',
        responseSchemaId: null,
      },
    ],
    behavior: {
      kind: 'decision',
      version: 1,
      inputSchemaId: 'schema-str',
      inputPortId: 'port-in',
      cases: [
        {
          id: 'case-1',
          guard: {
            op: 'equals',
            left: { kind: 'read', source: 'input', path: ['status'] },
            right: { kind: 'literal', value: 'alpha' },
          },
          outputPortId: 'port-out-case1',
          value: { kind: 'literal', value: 'result-alpha' },
        },
        {
          id: 'case-2',
          guard: {
            op: 'equals',
            left: { kind: 'read', source: 'input', path: ['status'] },
            right: { kind: 'literal', value: 'beta' },
          },
          outputPortId: 'port-out-case2',
          value: { kind: 'literal', value: 'result-beta' },
        },
      ],
      fallback: {
        outputPortId: 'port-out-fallback',
        value: { kind: 'literal', value: 'result-fallback' },
      },
    },
  };

  it('evaluates cases in order and emits on first matching case output port', () => {
    const res = runDecision(testDecisionElement, { status: 'alpha' }, { schemas });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.emission.portId).toBe('port-out-case1');
      expect(res.emission.value).toBe('result-alpha');
      expect(res.emission.matchedCaseId).toBe('case-1');
    }
  });

  it('selects second case when first does not match', () => {
    const res = runDecision(testDecisionElement, { status: 'beta' }, { schemas });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.emission.portId).toBe('port-out-case2');
      expect(res.emission.value).toBe('result-beta');
      expect(res.emission.matchedCaseId).toBe('case-2');
    }
  });

  it('selects fallback when no case matches', () => {
    const res = runDecision(testDecisionElement, { status: 'gamma' }, { schemas });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.emission.portId).toBe('port-out-fallback');
      expect(res.emission.value).toBe('result-fallback');
      expect(res.emission.matchedCaseId).toBeNull();
    }
  });

  it('fails with modeled error on schema mismatch', () => {
    // Port expects schema-int, but value emitted is string
    const mismatchedElement: Element = {
      ...testDecisionElement,
      ports: [
        testDecisionElement.ports[0],
        {
          ...testDecisionElement.ports[1],
          schemaId: 'schema-int', // expects integer
        },
        testDecisionElement.ports[2],
        testDecisionElement.ports[3],
      ],
    };

    const res = runDecision(mismatchedElement, { status: 'alpha' }, { schemas });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe('schema-mismatch');
      expect(res.errorMessage).toContain('schema validation');
    }
  });
});
