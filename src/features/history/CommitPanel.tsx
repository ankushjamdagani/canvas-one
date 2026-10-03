/**
 * CommitPanel React component (RV-11a).
 *
 * Implements specifications from:
 * - specs/revamp/screens/scenario_commit_gate.png (approved D41 version)
 * - specs/revamp/screens/22B_save_checkpoint.png (structure reference)
 * - specs/revamp/decisions.md (D20, D27, D28, D40, D41)
 * - specs/revamp/design-revalidation.md (§2 exclusions: NO "no run" commits, NO "suggested from your edits" text)
 * - specs/revamp/contracts/commands.md ("Scenarios (D41)" Status + Commit panel)
 * - specs/revamp/contracts/run-identity.md §5
 */

import * as React from 'react';
import { Play, Check, X, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import type { Document } from '../../domain/studio/model';
import { scenarioStatusLabel, type ScenarioWithStatus } from '../runs/scenarioStatus';
import type { HistoryControllerLike } from './controller';
import { computeChangesList } from './diffSummary';
import type { RecordChangeItem } from './types';
import { requireResultMessage, ResultMessageContractError } from './resultMessage';

export interface CommitPanelProps {
  readonly controller?: HistoryControllerLike;
  readonly workingDocument?: Document | null;
  readonly baseDocument?: Document | null;
  readonly changes?: readonly RecordChangeItem[];
  readonly scenariosWithStatus?: readonly ScenarioWithStatus[];
  readonly isMain?: boolean;
  readonly onCommit?: (message: string) => Promise<unknown> | void;
  readonly onCancel?: () => void;
  readonly onRunScenario?: (scenarioId: string) => void;
  readonly onRunAll?: () => void;
  readonly isCommitting?: boolean;
  readonly className?: string;
  /** PanelHost already supplies the History title, controls, and outer chrome. */
  readonly hosted?: boolean;
  /**
   * Bumped by the host whenever a run is saved, so the open panel reloads its
   * scenario statuses without being closed and reopened.
   */
  readonly refreshToken?: number;
}

export function CommitPanel({
  controller,
  workingDocument: propWorkingDoc,
  baseDocument: propBaseDoc,
  changes: propChanges,
  scenariosWithStatus: propScenariosWithStatus,
  isMain: propIsMain,
  onCommit: propOnCommit,
  onCancel,
  onRunScenario,
  onRunAll,
  isCommitting: propIsCommitting,
  className,
  hosted = false,
  refreshToken = 0,
}: CommitPanelProps): React.JSX.Element {
  // Controller state subscription
  const controllerState = React.useSyncExternalStore(
    controller ? controller.subscribe : () => () => {},
    controller ? controller.getState : () => null,
    controller ? controller.getState : () => null,
  );

  const isMain = propIsMain ?? controllerState?.isMain ?? false;

  // Local state
  const [message, setMessage] = React.useState('');
  const [showAllChanges, setShowAllChanges] = React.useState(false);
  const [localWorkingDoc, setLocalWorkingDoc] = React.useState<Document | null>(propWorkingDoc ?? null);
  const [localBaseDoc, setLocalBaseDoc] = React.useState<Document | null>(propBaseDoc ?? null);
  const [scenarios, setScenarios] = React.useState<readonly ScenarioWithStatus[]>(
    propScenariosWithStatus ?? [],
  );
  const [isCommitting, setIsCommitting] = React.useState(propIsCommitting ?? false);
  const [commitError, setCommitError] = React.useState<string | null>(null);

  // Load documents and scenario statuses via the controller's public commit
  // preview API when a controller is provided. CommitPanel never reads the
  // controller's private session or repository directly.
  React.useEffect(() => {
    if (!controller) return;
    if (propWorkingDoc && propBaseDoc && propScenariosWithStatus) return;

    let isMounted = true;

    async function loadPreview() {
      if (!controller) return;
      try {
        const preview = await controller.loadCommitPreview();
        if (!isMounted) return;
        if (!propWorkingDoc) setLocalWorkingDoc(preview.workingDocument);
        if (!propBaseDoc) setLocalBaseDoc(preview.baseDocument);
        if (!propScenariosWithStatus) setScenarios(preview.scenarios);
      } catch (err) {
        if (isMounted) {
          setCommitError(requireResultMessage(err));
        }
      }
    }

    void loadPreview();

    return () => {
      isMounted = false;
    };
  }, [controller, propWorkingDoc, propBaseDoc, propScenariosWithStatus, refreshToken]);

  // Use props if provided, otherwise derived
  const workingDocument = propWorkingDoc ?? localWorkingDoc;
  const baseDocument = propBaseDoc ?? localBaseDoc;
  const changes = propChanges ?? computeChangesList(baseDocument, workingDocument);
  const scenarioList = propScenariosWithStatus ?? scenarios;

  const visibleChanges = showAllChanges ? changes : changes.slice(0, 3);

  // Scenario counts
  const totalScenarios = scenarioList.length;
  const passingScenarios = scenarioList.filter((s) => s.status.kind === 'passed').length;
  const remainingScenarios = totalScenarios - passingScenarios;
  const anyNotReady = scenarioList.some((s) => s.status.kind === 'not-ready');
  const allScenariosPass = totalScenarios > 0 && remainingScenarios === 0;

  // Validation
  const trimmedMessage = message.trim();
  const isMessageValid = trimmedMessage.length >= 1 && trimmedMessage.length <= 4000;
  const canCommit = allScenariosPass && isMessageValid && !isMain && !isCommitting;

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCommit) return;

    setIsCommitting(true);
    setCommitError(null);

    try {
      if (propOnCommit) {
        await propOnCommit(trimmedMessage);
      } else if (controller) {
        const res = await controller.commit(trimmedMessage);
        if (res.status !== 'applied') {
          if (res.status === 'stale') {
            setCommitError('Working copy changed concurrently. Please reload.');
          } else {
            setCommitError(requireResultMessage(res));
          }
          return;
        }
      }
    } catch (err) {
      if (err instanceof ResultMessageContractError) throw err;
      setCommitError(requireResultMessage(err));
    } finally {
      setIsCommitting(false);
    }
  };

  const commitDisabledReason = React.useMemo(() => {
    if (isMain) return 'Main never holds edits (D40): edit main directly to create a draft';
    if (totalScenarios === 0) return 'Add a scenario to run before committing';
    if (!allScenariosPass) return `Commit unlocks when all ${totalScenarios} scenarios pass.`;
    if (!isMessageValid) return 'Commit message is required (1-4000 characters).';
    return undefined;
  }, [isMain, totalScenarios, allScenariosPass, isMessageValid]);

  return (
    <div
      data-testid="commit-panel"
      className={cn(
        'flex flex-col h-full bg-card text-foreground overflow-hidden select-none',
        hosted ? 'rounded-none border-0 shadow-none' : 'rounded-panel border border-border shadow-panel',
        className,
      )}
    >
      {/* 1. Header */}
      {!hosted && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <h2 className="text-base font-semibold text-foreground">Commit</h2>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close commit panel"
              className="p-1 rounded-control text-muted-foreground hover:text-foreground hover:bg-sunken transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      {/* Scrollable Form Body */}
      <form onSubmit={handleCommit} className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* 2. CHANGES Block */}
        <section aria-labelledby="commit-changes-header" className="space-y-2">
          <div className="text-meta font-mono font-medium uppercase text-secondary-text">
            <span id="commit-changes-header">CHANGES</span>
          </div>

          <div className="rounded-control border border-border bg-sunken/40 divide-y divide-border/60">
            {changes.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground italic">No changes detected</p>
            ) : (
              visibleChanges.map((change) => {
                const isAdd = change.change === 'added';
                const isRemove = change.change === 'removed';
                const symbol = isAdd ? '+' : isRemove ? '−' : '~';
                const symbolColor = isAdd
                  ? 'text-primary'
                  : isRemove
                    ? 'text-risk-text'
                    : 'text-warning-text';

                return (
                  <div
                    key={`${change.recordKind}-${change.id}`}
                    data-testid={`change-item-${change.id}`}
                    className="flex items-center justify-between px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate pr-2">
                      <span className={cn('font-mono font-bold shrink-0 w-3 text-center', symbolColor)}>
                        {symbol}
                      </span>
                      <span className="font-medium text-foreground truncate">{change.label}</span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                      {change.detail}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {changes.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllChanges(!showAllChanges)}
              className="text-xs text-primary hover:underline font-medium block pt-1"
            >
              {showAllChanges ? 'Show fewer changes' : `See all ${changes.length} changes`}
            </button>
          )}
        </section>

        {/* 3. Commit Message Field */}
        <section aria-labelledby="commit-message-header" className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-foreground">
            <label id="commit-message-header" htmlFor="commit-message-input">
              Commit message
            </label>
            <span className="font-mono text-[11px] text-muted-foreground">
              {message.length} / 4000
            </span>
          </div>

          <Input
            id="commit-message-input"
            type="text"
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe what changed and why"
            maxLength={4000}
            className="h-8 text-sm"
          />
        </section>

        {/* 4. EVERY SCENARIO MUST PASS ON THIS VERSION (Gate) */}
        <section aria-labelledby="scenario-gate-header" className="space-y-2">
          <div className="text-meta font-mono font-medium uppercase text-secondary-text">
            <span id="scenario-gate-header">EVERY SCENARIO MUST PASS ON THIS VERSION</span>
          </div>

          <div className="rounded-control border border-border bg-sunken/40 divide-y divide-border/60">
            {scenarioList.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground italic">
                No scenarios in this document. Add at least one scenario to run and commit.
              </p>
            ) : (
              scenarioList.map(({ scenario, status }) => {
                const isPassed = status.kind === 'passed';
                const isNotReady = status.kind === 'not-ready';
                const statusText = scenarioStatusLabel(status);

                return (
                  <div
                    key={scenario.id}
                    data-testid={`scenario-row-${scenario.id}`}
                    className="flex items-center justify-between px-3 py-2.5 text-xs gap-2"
                  >
                    <div className="flex items-start gap-2.5 truncate">
                      {/* Status indicator dot */}
                      <span
                        className={cn(
                          'size-2 rounded-full shrink-0 mt-1',
                          isPassed && 'bg-primary',
                          status.kind === 'needs-rerun' && 'bg-warning',
                          status.kind === 'failed' && 'bg-risk-text',
                          status.kind === 'not-run' && 'bg-muted-foreground/40',
                          isNotReady && 'bg-risk-text',
                        )}
                      />
                      <div className="flex flex-col truncate">
                        <span className="font-semibold text-foreground truncate">{scenario.label}</span>
                        <span className="text-[11px] text-muted-foreground truncate">{statusText}</span>
                      </div>
                    </div>

                    {/* Action right */}
                    <div className="shrink-0">
                      {isPassed ? (
                        <div
                          data-testid={`scenario-passed-check-${scenario.id}`}
                          className="flex items-center justify-center size-6 text-primary"
                        >
                          <Check className="size-4" strokeWidth={2.5} />
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          disabled={isNotReady}
                          title={status.kind === 'not-ready' ? status.issues[0]?.message : undefined}
                          onClick={() => onRunScenario?.(scenario.id)}
                        >
                          <Play className="size-3 mr-1 fill-current" />
                          Run
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Scenario passing count & Run remaining */}
          {totalScenarios > 0 && (
            <div className="flex items-center justify-between pt-1 text-xs">
              <span data-testid="passing-scenarios-summary" className="font-mono text-muted-foreground">
                {passingScenarios} of {totalScenarios} passing
              </span>

              {remainingScenarios > 0 && onRunAll && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs font-semibold text-primary hover:text-primary-hover px-2"
                  disabled={anyNotReady}
                  title={anyNotReady ? 'Run all is disabled while any scenario is not ready' : undefined}
                  onClick={onRunAll}
                >
                  <Play className="size-3 mr-1 fill-current" />
                  Run the {remainingScenarios} remaining
                </Button>
              )}
            </div>
          )}
        </section>

        {/* Explanatory notice / Error */}
        {commitError && (
          <div className="flex items-start gap-1.5 p-2 rounded-control bg-risk-tint border border-risk-edge text-risk-text text-xs">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{commitError}</span>
          </div>
        )}

        {!allScenariosPass && (
          <p
            data-testid="commit-gate-notice"
            className="text-xs text-risk-text font-medium"
          >
            {totalScenarios === 0
              ? 'Add a scenario before committing.'
              : `Commit unlocks when all ${totalScenarios} scenarios pass.`}
          </p>
        )}
      </form>

      {/* 5. Footer Buttons */}
      <div className="px-4 py-3 border-t border-border bg-card flex items-center gap-3">
        <Button
          type="button"
          className="flex-1 bg-primary hover:bg-primary-hover text-primary-foreground font-semibold"
          disabled={!canCommit}
          title={commitDisabledReason}
          onClick={handleCommit}
        >
          {isCommitting ? 'Committing...' : 'Commit'}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={isCommitting}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
