/**
 * PublishFlow (RV-11b review round) — orchestrates the publish review dialog
 * (22C), the full-panel compare-and-resolve view (22F), and the published
 * confirmation (22D) off PublishController's state.
 *
 * - specs/revamp/contracts/commands.md (history.prepare-publish, history.resolve-conflict, history.publish)
 * - specs/revamp/contracts/transactions.md §4 & §5
 * - specs/revamp/decisions.md D25 (sequence conflicts), D26 (no publish undo —
 *   irreversible, explicit confirm), D29 (source branch closes by default)
 * - specs/revamp/design-revalidation.md §2: excludes "Undo publish" (D26),
 *   "minor · fits the diff" version reasoning, p95/burst/"vs X" deltas, and
 *   single-letter shortcuts (commands.md §1 allows only Mod+Z, Mod+Shift+Z,
 *   Delete/Backspace, F2) — none of that appears anywhere in this flow.
 *
 * 22E (draft behind main) is a separate, standalone component
 * (DraftBehindMainBanner) the app shell mounts proactively; this flow only
 * shows a plain retry notice for the rare genuine `stale` prepare-publish
 * result (an optimistic-concurrency mismatch — different from "main has new
 * publications", which is the normal case DraftBehindMainBanner covers).
 */

import * as React from 'react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import type { ConflictResolution } from '../../domain/versioning/resolve';
import type { VersionBumpKind } from '../../domain/versioning/publication';
import { PublishReviewDialog } from './PublishReviewDialog';
import { CompareAndResolvePanel } from './CompareAndResolvePanel';
import { PublishedNotice } from './PublishedNotice';
import type { PublishControllerLike } from './publishController';
import { requireResultMessage } from './resultMessage';

export interface PublishFlowProps {
  readonly controller: PublishControllerLike;
  readonly onClose?: () => void;
  readonly className?: string;
}

export function PublishFlow({ controller, onClose, className }: PublishFlowProps): React.JSX.Element {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);

  const [closed, setClosed] = React.useState(false);
  const [view, setView] = React.useState<'review' | 'compare'>('review');
  const [isResolving, setIsResolving] = React.useState(false);
  const [runningScenarioId, setRunningScenarioId] = React.useState<string | null>(null);

  // 22C "nothing chosen yet": no version bump is pre-selected.
  const [selectedBump, setSelectedBump] = React.useState<VersionBumpKind | null>(null);
  const [title, setTitle] = React.useState('');
  const [rationale, setRationale] = React.useState('');
  const [ticketUrl, setTicketUrl] = React.useState('');
  // Checkbox reads "Close this draft after publishing"; checked (the D29
  // default) means keepSourceOpen=false when calling controller.publish.
  const [closeSourceAfterPublish, setCloseSourceAfterPublish] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);
  const [isPublishing, setIsPublishing] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (controller.getState().status === 'idle') void controller.prepare();
  }, [controller]);

  const handleResolve = React.useCallback(
    async (conflictId: string, resolution: ConflictResolution) => {
      setFormError(null);
      setIsResolving(true);
      try {
        const res = await controller.resolveConflict(conflictId, resolution);
        if (res.status !== 'done') {
          setFormError(requireResultMessage(res));
        }
      } finally {
        setIsResolving(false);
      }
    },
    [controller],
  );

  const handleResolveAll = React.useCallback(
    async (side: 'ours' | 'theirs') => {
      setFormError(null);
      setIsResolving(true);
      try {
        const result = await controller.resolveAllConflicts(side);
        if (result && result.status !== 'done') setFormError(requireResultMessage(result));
      } finally {
        setIsResolving(false);
      }
    },
    [controller],
  );

  const handleRunScenario = React.useCallback(
    async (scenarioId: string) => {
      setFormError(null);
      setRunningScenarioId(scenarioId);
      try {
        const result = await controller.runScenario(scenarioId);
        if (result.status !== 'done') setFormError(requireResultMessage(result));
      } finally {
        setRunningScenarioId(null);
      }
    },
    [controller],
  );

  const handleApplyAndRun = React.useCallback(async () => {
    for (const { scenario, status } of state.scenarios) {
      if (status.kind === 'passed') continue;
      await handleRunScenario(scenario.id);
    }
    setView('review');
  }, [state.scenarios, handleRunScenario]);

  const selectedSuggestion = state.versionSuggestions?.suggestions.find((s) => s.kind === selectedBump) ?? null;
  const trimmedTicketUrl = ticketUrl.trim();
  let ticketUrlValid = true;
  if (trimmedTicketUrl.length > 0) {
    try {
      const parsed = new URL(trimmedTicketUrl);
      ticketUrlValid = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password && trimmedTicketUrl.length <= 2048;
    } catch {
      ticketUrlValid = false;
    }
  }

  const handleRequestConfirm = () => setConfirming(true);
  const handleCancelConfirm = () => setConfirming(false);

  const handleConfirmPublish = async () => {
    if (!selectedSuggestion) return;
    setIsPublishing(true);
    setFormError(null);
    try {
      const res = await controller.publish(
        {
          version: selectedSuggestion.version,
          title: title.trim(),
          rationale,
          ticketUrl: trimmedTicketUrl.length > 0 ? trimmedTicketUrl : null,
        },
        !closeSourceAfterPublish,
      );
      if (res.status !== 'applied') {
        setFormError(requireResultMessage(res));
        setConfirming(false);
        return;
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const close = () => { setClosed(true); onClose?.(); };
  if (closed) return <></>;

  if (state.status === 'error') {
    const message = requireResultMessage(state.lastError);
    return (
      <div data-testid="publish-flow" className={cn('rounded-panel border border-border bg-card p-4', className)}>
        <div className="flex items-start gap-1.5 p-2 rounded-control bg-risk-tint border border-risk-edge text-risk-text text-xs">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{message}</span>
        </div>
      </div>
    );
  }

  if (state.status === 'blocked') {
    if (state.blockedMessage === null) {
      throw new Error('PublishController entered status "blocked" without a blockedMessage');
    }
    return (
      <div data-testid="publish-flow" className={cn('rounded-panel border border-border bg-card p-4', className)}>
        <div data-testid="publish-blocked" className="flex items-start gap-1.5 p-2 rounded-control bg-risk-tint border border-risk-edge text-risk-text text-xs">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{state.blockedMessage}</span>
        </div>
      </div>
    );
  }

  if (state.status === 'idle' || state.status === 'preparing') {
    return (
      <div data-testid="publish-flow" className={cn('rounded-panel border border-border bg-card p-4', className)}>
        <p data-testid="publish-preparing" className="text-sm text-muted-foreground italic">
          Preparing an isolated candidate from main…
        </p>
      </div>
    );
  }

  // Rare optimistic-concurrency mismatch (contracts.md's `stale`): the source
  // or main revision the UI expected changed underneath it. Distinct from the
  // normal "main published new versions" case, which DraftBehindMainBanner
  // covers using a real conflict count from a successful prepare().
  if (state.status === 'behind-main') {
    if (!state.staleInfo) {
      throw new Error('PublishController entered status "behind-main" without staleInfo');
    }
    return (
      <div data-testid="publish-flow" className={cn('rounded-panel border border-border bg-card p-4 space-y-3', className)}>
        <div data-testid="publish-stale" className="flex items-start gap-2 p-3 rounded-control bg-risk-tint border border-risk-edge text-risk-text text-sm">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">This draft&apos;s revision changed elsewhere.</p>
            <p className="text-xs mt-1">
              Expected {state.staleInfo.scope} revision {String(state.staleInfo.expected)}, found {String(state.staleInfo.actual)}.
            </p>
          </div>
        </div>
        <Button type="button" size="sm" onClick={() => void controller.prepare()}>
          <RotateCcw className="size-3.5 mr-1" />
          Try again
        </Button>
      </div>
    );
  }

  if (state.status === 'published') {
    if (!state.publication || state.publishedSourceClosed === null) {
      throw new Error('PublishController entered status "published" without a publication record');
    }
    return (
      <div data-testid="publish-flow" className={cn('space-y-3', className)}>
        <PublishedNotice
          publication={state.publication}
          sourceBranchLabel={state.sourceBranchLabel}
          sourceBranchClosed={state.publishedSourceClosed}
        />
        {onClose && (
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            <X className="size-3.5 mr-1" />
            Close
          </Button>
        )}
      </div>
    );
  }

  // state.status === 'review'
  if (!state.mergeInputs || !state.mergedDocument) {
    throw new Error('PublishController is in status "review" without merge inputs/document');
  }

  if (view === 'compare') {
    return (
      <CompareAndResolvePanel
        className={className}
        sourceBranchLabel={state.sourceBranchLabel}
        mainBranchLabel={state.mainBranchLabel}
        conflicts={state.conflicts}
        resolvedFields={state.resolvedFields}
        mergeInputs={state.mergeInputs}
        mergedDocument={state.mergedDocument}
        eligible={state.eligible}
        totalScenarios={state.scenarios.length}
        passingScenarios={state.scenarios.filter((s) => s.status.kind === 'passed').length}
        isBusy={isResolving || runningScenarioId !== null}
        errorMessage={formError}
        onResolve={(conflictId, resolution) => void handleResolve(conflictId, resolution)}
        onResolveAll={(side) => void handleResolveAll(side)}
        onReopen={async (field) => {
          setIsResolving(true);
          try { await controller.reopenConflict(field); } finally { setIsResolving(false); }
        }}
        onApplyAndRun={handleApplyAndRun}
        onClose={() => setView('review')}
      />
    );
  }

  return (
    <PublishReviewDialog
      open
      onOpenChange={(next) => {
        if (!next && !isPublishing) close();
      }}
      className={className}
      sourceBranchLabel={state.sourceBranchLabel}
      mainBranchLabel={state.mainBranchLabel}
      commitsSinceFork={state.commitsSinceFork}
      componentsTouchedCount={state.componentsTouchedCount}
      conflicts={state.conflicts}
      mergeInputs={state.mergeInputs}
      scenarios={state.scenarios}
      eligible={state.eligible}
      runningScenarioId={runningScenarioId}
      onRunScenario={(id) => void handleRunScenario(id)}
      onOpenCompare={() => setView('compare')}
      versionSuggestions={state.versionSuggestions}
      currentVersionKey={state.currentVersionKey}
      selectedBump={selectedBump}
      onSelectBump={setSelectedBump}
      title={title}
      onTitleChange={setTitle}
      rationale={rationale}
      onRationaleChange={setRationale}
      ticketUrl={ticketUrl}
      ticketUrlValid={ticketUrlValid}
      onTicketUrlChange={setTicketUrl}
      closeSourceAfterPublish={closeSourceAfterPublish}
      onCloseSourceAfterPublishChange={setCloseSourceAfterPublish}
      confirming={confirming}
      isPublishing={isPublishing}
      formError={formError}
      onCancel={close}
      onRequestConfirm={handleRequestConfirm}
      onCancelConfirm={handleCancelConfirm}
      onConfirmPublish={() => void handleConfirmPublish()}
    />
  );
}
