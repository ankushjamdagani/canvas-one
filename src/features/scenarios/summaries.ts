import type { DraftAssertion, DraftRequestClass } from './draftScenario';
import type { Boundary, Fault, Input, Document } from '../../domain/studio/model';
import { endpointLabel, allElementOptions } from './pickers';

export function summarizeWorkloadMix(classes: readonly DraftRequestClass[]): string {
  if (classes.length === 0) return 'No request classes';
  const totalWeight = classes.reduce((sum, c) => sum + (Number.isFinite(c.weight) ? c.weight : 0), 0);
  return classes.map(c => {
    const w = Number.isFinite(c.weight) ? c.weight : 0;
    const pct = totalWeight > 0 ? Math.round((w / totalWeight) * 100) : 0;
    return `${c.name || 'unnamed'} ${pct}% ${c.operation}`;
  }).join(' · ');
}

export function summarizeFault(fault: Fault, document: Document): string {
  const host = document.elements.find(e => e.id === fault.hostId);
  const hostName = host ? host.label : fault.hostId;
  const down = (fault.downAtMs / 1000).toFixed(1);
  const up = (fault.upAtMs / 1000).toFixed(1);
  const noticed = (fault.detectionDelayMs / 1000).toFixed(1);
  return `${hostName} · down ${down} s → up ${up} s · noticed after ${noticed} s`;
}

export function summarizeAssertion(assertion: DraftAssertion, document: Document): string {
  let operatorStr: string = assertion.operator;
  if (operatorStr === 'at-least') operatorStr = 'at least';
  if (operatorStr === 'at-most') operatorStr = 'at most';

  const val = typeof assertion.expected === 'string' ? `"${assertion.expected}"` : String(assertion.expected);
  
  // Try to build a subject label from subject
  let subjectLabel = assertion.label || 'Check';
  if (assertion.subject.kind === 'count') {
      subjectLabel = `${assertion.subject.scope} count`;
  } else if (assertion.subject.kind === 'final-state') {
      const el = document.elements.find(e => e.id === (assertion.subject as any).elementId);
      subjectLabel = el ? el.label : 'element';
  } else if (assertion.subject.kind === 'output') {
      const el = document.elements.find(e => e.id === (assertion.subject as any).port?.elementId);
      subjectLabel = el ? `${el.label} output` : 'output';
  }

  return `${subjectLabel} · ${operatorStr} ${val}`;
}

export function summarizeStep(input: Input, index: number, document: Document, previousInput?: Input): string {
  const entryLabel = endpointLabel(document, input.entry);
  let afterStr = 'after previous';
  if (input.atMs !== null) {
    afterStr = `after ${(input.atMs / 1000).toFixed(1)} s`;
  } else if (index === 0) {
    afterStr = 'at start';
  } else if (previousInput && input.journeyId === previousInput.journeyId) {
    afterStr = 'same journey';
  }
  return `step ${index + 1} · ${entryLabel} · ${afterStr}`;
}

export function summarizeBoundary(boundary: Boundary, document: Document): string {
  const label = endpointLabel(document, boundary.source);
  const count = boundary.responses.length;
  return `${label} · ${count} ${count === 1 ? 'reply' : 'replies'}`;
}
