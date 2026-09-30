import type { Id, Document, Scenario } from '../../domain/studio/model';
import type { DraftScenario, DraftAssertion } from '../scenarios/types';

export function planAddProbe(
  document: Document,
  scenario: Scenario,
  elementId: Id,
  mintId: () => Id
): {
  readonly disabledReason: string | null;
  readonly patch?: (s: DraftScenario) => DraftScenario;
  readonly newCheckId?: Id;
} {
  const element = document.elements.find((e) => e.id === elementId);
  if (!element) return { disabledReason: 'element-not-found' };

  if (scenario.mode === 'logical') {
    const outPort = element.ports.find((p) => p.direction === 'out' && p.channel !== 'event');
    if (!outPort) return { disabledReason: 'no-data-output' };

    const checkId = mintId();
    const assertion: DraftAssertion = {
      id: checkId,
      label: 'Check output',
      subject: {
        kind: 'output',
        port: { element: elementId, port: outPort.id },
        path: [],
      },
      operator: 'equals',
      expected: null,
    };

    return {
      disabledReason: null,
      newCheckId: checkId,
      patch: (s) => ({ ...s, assertions: [...s.assertions, assertion] }),
    };
  } else {
    // timed
    const checkId = mintId();
    const assertion: DraftAssertion = {
      id: checkId,
      label: 'Check throughput',
      subject: {
        kind: 'metric',
        elementId,
        key: 'throughput',
      },
      operator: 'at-least',
      expected: 1,
    };

    return {
      disabledReason: null,
      newCheckId: checkId,
      patch: (s) => ({ ...s, assertions: [...s.assertions, assertion] }),
    };
  }
}
