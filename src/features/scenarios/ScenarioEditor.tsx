/**
 * Scenario editor: inspector-dock content (RV-05c).
 *
 * Implements specs/revamp/contracts/commands.md §4 "Editor sections" (inspector dock,
 * Apply/Cancel per §6): header (name, mode shown, not editable after creation); What
 * goes in; What happens during the run; What should be true; Run settings. Screens:
 * scenario_traffic_editor.png (timed), scenario_steps_editor.png (logical).
 *
 * "Run itself is passed in; no runner here" (brief) -- this component has no Run
 * button; it only edits the draft and calls onApply/onCancel.
 */

import * as React from 'react';
import { Activity, AlertCircle, GitCommitHorizontal, X } from 'lucide-react';
import type { Document } from '../../domain/studio/model';
import type { CheckResult } from '../../domain/studio/runner/types';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { cn } from '../../lib/utils';
import { TrafficSection } from './TrafficSection';
import { StepsSection } from './StepsSection';
import { FaultsSection } from './FaultsSection';
import { BoundariesSection } from './BoundariesSection';
import { AssertionsSection } from './AssertionsSection';
import type { ScenarioDraftHandle, ScenarioSection, MintId } from './types';
import type { DraftScenario } from './draftScenario';
import { SCENARIO_SEED_MAX } from './budgets';

export interface ScenarioEditorProps {
  readonly document: Document;
  readonly handle: ScenarioDraftHandle;
  readonly onChange: (patch: (s: DraftScenario) => DraftScenario) => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
  readonly onClose?: () => void;
  readonly mintId: MintId;
  readonly lastRunChecks?: ReadonlyMap<string, CheckResult> | null;
  readonly focusName?: boolean;
  /** A check to open expanded (flow probe added from the canvas). */
  readonly focusAssertionId?: string | null;
  /** Inside PanelHost, which supplies the title bar and close button. */
  readonly hosted?: boolean;
}

function sectionErrorCount(handle: ScenarioDraftHandle, section: ScenarioSection): number {
  return handle.issuesBySection[section].filter((i) => i.severity === 'error').length;
}

export function ScenarioEditor({ document, handle, onChange, onApply, onCancel, onClose = onCancel, mintId, lastRunChecks, focusName = false, focusAssertionId = null, hosted = false }: ScenarioEditorProps) {
  const scenario = handle.scenario;
  const [boundaryGuardsComplete, setBoundaryGuardsComplete] = React.useState(true);

  React.useEffect(() => {
    setBoundaryGuardsComplete(true);
  }, [scenario?.id]);

  if (!scenario) {
    return (
      <div data-testid="scenario-editor-missing" className="p-4 text-xs text-secondary-text">
        This scenario was deleted elsewhere.
        <div className="pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const modeSubtitle =
    scenario.mode === 'timed' ? 'Traffic over time — measures latency, throughput and failures.' : 'Step by step — checks states and outputs; no timing.';

  const headerErrors = sectionErrorCount(handle, 'header');
  const runSettingsErrors = sectionErrorCount(handle, 'runSettings');
  const generalErrors = sectionErrorCount(handle, 'general');

  const isSaving = handle.status === 'saving';
  const canApply = !isSaving && boundaryGuardsComplete && (handle.dirty || handle.isNew);

  return (
    <div data-testid="scenario-editor" className="flex flex-col h-full text-xs">
      {hosted ? null : (
        <div className="flex items-center justify-between px-3 py-2 border-b border-divider">
          <span className="font-mono text-[10px] font-medium tracking-wider text-secondary-text uppercase">Scenario</span>
          <button type="button" onClick={onClose} aria-label="Close editor" className="inline-flex items-center justify-center text-secondary-text hover:text-foreground pointer-coarse:size-11">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Header */}
        <section data-testid="scenario-section-header" className="space-y-1.5">
          <Input
            autoFocus={focusName}
            value={scenario.label}
            onChange={(e) => onChange((s) => ({ ...s, label: e.target.value }))}
            aria-label="Scenario name"
            aria-invalid={headerErrors > 0}
            className="font-semibold"
          />
          <div className="flex items-center gap-1.5 text-secondary-text">
            {scenario.mode === 'timed' ? <Activity className="size-3.5" aria-hidden="true" /> : <GitCommitHorizontal className="size-3.5" aria-hidden="true" />}
            <span>{modeSubtitle}</span>
          </div>
          {headerErrors > 0 && <IssueList issues={handle.issuesBySection.header} />}
        </section>

        {scenario.mode === 'timed' ? (
          <TrafficSection document={document} scenario={scenario} onChange={onChange} mintId={mintId} />
        ) : (
          <StepsSection document={document} scenario={scenario} onChange={onChange} mintId={mintId} />
        )}
        {handle.issuesBySection[scenario.mode === 'timed' ? 'traffic' : 'steps'].length > 0 && (
          <IssueList issues={handle.issuesBySection[scenario.mode === 'timed' ? 'traffic' : 'steps']} />
        )}

        {scenario.mode === 'timed' ? (
          <FaultsSection document={document} scenario={scenario} onChange={onChange} mintId={mintId} />
        ) : (
          <BoundariesSection document={document} scenario={scenario} onChange={onChange} mintId={mintId} onGuardValidityChange={setBoundaryGuardsComplete} />
        )}
        {handle.issuesBySection[scenario.mode === 'timed' ? 'faults' : 'boundaries'].length > 0 && (
          <IssueList issues={handle.issuesBySection[scenario.mode === 'timed' ? 'faults' : 'boundaries']} />
        )}

        <AssertionsSection document={document} scenario={scenario} onChange={onChange} mintId={mintId} lastRunChecks={lastRunChecks} focusAssertionId={focusAssertionId} />
        {handle.issuesBySection.assertions.length > 0 && <IssueList issues={handle.issuesBySection.assertions} />}

        {/* Run settings */}
        <section data-testid="scenario-section-run-settings" className="space-y-2">
          <div className="font-mono text-[10px] font-medium tracking-wider text-secondary-text uppercase">Run settings</div>

          {scenario.mode === 'timed' ? (
            <div className="space-y-2">
              <label className="space-y-1 text-[11px] text-secondary-text">
                Completion
                <NativeSelect
                  value={scenario.completion.kind ?? ''}
                  aria-invalid={scenario.completion.kind === null}
                  onChange={(e) => {
                    const value = e.target.value;
                    onChange((s) => ({
                      ...s,
                      completion:
                        value === 'horizon'
                          ? { kind: 'horizon', horizonMs: null }
                          : value === 'drain'
                            ? {
                                kind: 'drain',
                                arrivalHorizonMs: null,
                                deadlineMs: null,
                              }
                            : { kind: null },
                    }));
                  }}
                  aria-label="Completion kind"
                >
                  <NativeSelectOption value="" disabled>
                    Choose…
                  </NativeSelectOption>
                  <NativeSelectOption value="horizon">Fixed horizon</NativeSelectOption>
                  <NativeSelectOption value="drain">Drain</NativeSelectOption>
                </NativeSelect>
              </label>

              {scenario.completion.kind === 'horizon' && (
                <label className="space-y-1 text-[11px] text-secondary-text">
                  Horizon (ms)
                  <Input
                    type="number"
                    min={1000}
                    max={300000}
                    placeholder="—"
                    value={scenario.completion.horizonMs ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const v = raw === '' ? null : Number(raw);
                      onChange((s) =>
                        s.completion.kind === 'horizon' && (v === null || Number.isFinite(v))
                          ? {
                              ...s,
                              completion: { kind: 'horizon', horizonMs: v },
                            }
                          : s,
                      );
                    }}
                  />
                </label>
              )}

              {scenario.completion.kind === 'drain' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-[11px] text-secondary-text">
                    Arrivals stop after (ms)
                    <Input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={scenario.completion.arrivalHorizonMs ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const v = raw === '' ? null : Number(raw);
                        onChange((s) =>
                          s.completion.kind === 'drain' && (v === null || Number.isFinite(v))
                            ? {
                                ...s,
                                completion: {
                                  ...s.completion,
                                  arrivalHorizonMs: v,
                                },
                              }
                            : s,
                        );
                      }}
                    />
                  </label>
                  <label className="space-y-1 text-[11px] text-secondary-text">
                    Deadline (ms)
                    <Input
                      type="number"
                      min={0}
                      max={600000}
                      placeholder="—"
                      value={scenario.completion.deadlineMs ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const v = raw === '' ? null : Number(raw);
                        onChange((s) =>
                          s.completion.kind === 'drain' && (v === null || Number.isFinite(v))
                            ? {
                                ...s,
                                completion: { ...s.completion, deadlineMs: v },
                              }
                            : s,
                        );
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-secondary-text">Runs step by step. No timing or throughput.</p>
          )}

          <label className="space-y-1 text-[11px] text-secondary-text">
            Seed
            <Input
              type="number"
              min={0}
              max={SCENARIO_SEED_MAX}
              value={scenario.seed}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange((s) => (Number.isFinite(v) ? { ...s, seed: v } : s));
              }}
              aria-label="Seed"
            />
          </label>

          {(runSettingsErrors > 0 || generalErrors > 0) && <IssueList issues={[...handle.issuesBySection.runSettings, ...handle.issuesBySection.general]} />}
        </section>
      </div>

      <ScenarioEditorFooter handle={handle} canApply={canApply} onApply={onApply} onCancel={onCancel} />
    </div>
  );
}

function IssueList({
  issues,
}: {
  readonly issues: readonly {
    readonly message: string;
    readonly severity: string;
  }[];
}) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {issues.map((issue, i) => (
        <li key={i} className={cn('flex items-start gap-1 text-[11px]', issue.severity === 'error' ? 'text-risk-text' : 'text-warning-text')}>
          <AlertCircle className="size-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

function ScenarioEditorFooter({
  handle,
  canApply,
  onApply,
  onCancel,
}: {
  readonly handle: ScenarioDraftHandle;
  readonly canApply: boolean;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}) {
  const statusText =
    handle.status === 'saving'
      ? 'Saving…'
      : handle.status === 'stale'
        ? 'This scenario changed elsewhere.'
        : handle.status === 'invalid'
          ? (handle.generalIssue ?? 'Fix the highlighted fields before applying.')
          : handle.dirty || handle.isNew
            ? 'Unsaved changes · Apply, then run again'
            : null;

  return (
    <div className="flex flex-col gap-2 px-3 py-2 border-t border-divider bg-panel">
      {statusText && (
        <div
          data-testid="scenario-editor-status"
          className={cn(
            'flex items-center gap-1.5 text-[11px]',
            handle.status === 'invalid' || handle.status === 'stale' ? 'text-risk-text' : 'text-warning-text'
          )}
        >
          <div className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {statusText}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="sm" onClick={onApply} disabled={!canApply} data-testid="scenario-editor-apply" className="w-full">
          Apply
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={handle.status === 'saving'} className="w-full">
          Cancel
        </Button>
      </div>
    </div>
  );
}
