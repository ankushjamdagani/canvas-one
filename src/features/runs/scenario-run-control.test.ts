import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScenarioRunControl, type ScenarioEntry } from './ScenarioRunControl';

const noop = () => {};

function makeProps(scenarios: readonly ScenarioEntry[], selectedId: string | null) {
  return {
    scenarios,
    selectedId,
    runPhase: 'idle' as const,
    onSelect: noop,
    onRun: noop,
    onRunAll: noop,
    onNew: noop,
    onDuplicate: noop,
    onEdit: noop,
    onRename: noop,
    onDelete: noop,
  };
}

describe('ScenarioRunControl (Item 6: not-ready status)', () => {
  it('disables Run for the selected scenario when it is not-ready, with the first issue as the reason', () => {
    const notReadyScenario: ScenarioEntry = {
      id: 'scn-1',
      label: 'Broken scenario',
      mode: 'logical',
      status: {
        kind: 'not-ready',
        issues: [
          { code: 'structural-rule', path: [], entityId: null, severity: 'error', message: 'Scenario references a deleted element.' },
        ],
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(ScenarioRunControl, makeProps([notReadyScenario], 'scn-1')),
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('Run scenario simulation');
  });

  it('does not disable Run for a selected scenario that is ready, even if another scenario in the list is not-ready', () => {
    const readyScenario: ScenarioEntry = {
      id: 'scn-1',
      label: 'Good scenario',
      mode: 'logical',
      status: { kind: 'not-run' },
    };
    const notReadyScenario: ScenarioEntry = {
      id: 'scn-2',
      label: 'Broken scenario',
      mode: 'logical',
      status: {
        kind: 'not-ready',
        issues: [
          { code: 'structural-rule', path: [], entityId: null, severity: 'error', message: 'Scenario references a deleted element.' },
        ],
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(ScenarioRunControl, makeProps([readyScenario, notReadyScenario], 'scn-1')),
    );

    // The resting Run button (always server-rendered, unlike the popover's "Run all"
    // which only mounts client-side) must stay enabled for the ready selection.
    expect(html).not.toContain('disabled=""');
  });
});
