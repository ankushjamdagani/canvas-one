import type { Document, Id, Scenario } from '../studio/model.js';
import type { DraftAssertion, DraftScenario } from './scenarios/draftScenario.js';

export type AddProbePlan =
  | { readonly ok: true; readonly check: DraftAssertion; readonly patch: (scenario: DraftScenario) => DraftScenario }
  | { readonly ok: false; readonly reason: string };

export function planAddProbe(
  document: Document,
  scenario: Scenario,
  elementId: Id,
  mintId: () => Id
): AddProbePlan {
  const element = document.elements.find((e) => e.id === elementId);
  if (!element) return { ok: false, reason: 'The selected component no longer exists' };
  if (!scenario.scopeElementIds.includes(elementId)) {
    return { ok: false, reason: 'This component is not in the selected scenario scope' };
  }

  let check: DraftAssertion;
  if (scenario.mode === 'logical') {
    const outPort = element.ports.find((p) => p.direction === 'out' && p.channel !== 'event');
    if (!outPort) return { ok: false, reason: 'This component has no non-event output port to probe' };
    check = {
      id: mintId(),
      label: 'Check output',
      subject: { kind: 'output', port: { elementId, portId: outPort.id }, path: [] },
      operator: 'equals',
      expected: null,
    };
  } else {
    check = {
      id: mintId(),
      label: 'Check throughput',
      subject: { kind: 'metric', elementId, key: 'throughput' },
      operator: 'at-least',
      expected: null,
    };
  }

  return { ok: true, check, patch: (draft) => ({ ...draft, assertions: [...draft.assertions, check] }) };
}
