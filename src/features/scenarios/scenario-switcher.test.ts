import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScenarioSwitcher, type ScenarioSwitcherEntry } from './ScenarioSwitcher';

const noop = () => {};

function makeProps(scenarios: readonly ScenarioSwitcherEntry[], selectedId: string | null) {
  return {
    scenarios,
    selectedId,
    runPhase: 'idle' as const,
    onSelect: noop,
    onRun: noop,
    onRunAll: noop,
    onNew: noop,
    onEdit: noop,
    onRename: noop,
    onDelete: noop,
  };
}

describe('ScenarioSwitcher: not-ready status (ported from the retired ScenarioRunControl)', () => {
  it('disables Run for the selected scenario when it is not-ready, with the first issue as the reason', () => {
    const notReadyScenario: ScenarioSwitcherEntry = {
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
      React.createElement(ScenarioSwitcher, makeProps([notReadyScenario], 'scn-1')),
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('Run scenario simulation');
  });

  it('does not disable Run for a selected scenario that is ready, even if another scenario in the list is not-ready', () => {
    const readyScenario: ScenarioSwitcherEntry = {
      id: 'scn-1',
      label: 'Good scenario',
      mode: 'logical',
      status: { kind: 'not-run' },
    };
    const notReadyScenario: ScenarioSwitcherEntry = {
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
      React.createElement(ScenarioSwitcher, makeProps([readyScenario, notReadyScenario], 'scn-1')),
    );

    // The resting Run button (always server-rendered, unlike the popover's "Run all"
    // which only mounts client-side) must stay enabled for the ready selection.
    expect(html).not.toContain('disabled=""');
  });
});

describe('ScenarioSwitcher: Stop', () => {
  const timed = (): ScenarioSwitcherEntry => ({
    id: 'scn-1', label: 'Timed', mode: 'timed', status: { kind: 'not-run' },
  });

  it('shows Stop beside Pause and Reset while a timed run is active, and Stopping… once pressed', () => {
    const active = { ...makeProps([timed()], 'scn-1'), runPhase: 'running' as const, onStop: () => undefined };
    expect(renderToStaticMarkup(React.createElement(ScenarioSwitcher, active))).toContain('data-testid="scenario-stop-btn"');
    const stopping = renderToStaticMarkup(React.createElement(ScenarioSwitcher, { ...active, isStopping: true }));
    expect(stopping).toContain('Stopping…');
    expect(stopping).toMatch(/data-testid="scenario-stop-btn"[^>]*disabled/);
  });

  it('has no Stop for a logical scenario or while idle', () => {
    const logical: ScenarioSwitcherEntry = { id: 'scn-1', label: 'Logical', mode: 'logical', status: { kind: 'not-run' } };
    const props = { ...makeProps([logical], 'scn-1'), runPhase: 'running' as const, onStop: () => undefined };
    expect(renderToStaticMarkup(React.createElement(ScenarioSwitcher, props))).not.toContain('scenario-stop-btn');
    expect(renderToStaticMarkup(React.createElement(ScenarioSwitcher, { ...makeProps([timed()], 'scn-1'), onStop: () => undefined }))).not.toContain('scenario-stop-btn');
  });
});
