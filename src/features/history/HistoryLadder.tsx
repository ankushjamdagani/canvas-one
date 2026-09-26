/**
 * HistoryLadder React component (RV-11a).
 *
 * Implements specifications from:
 * - specs/revamp/screens/22A_history_ladder.png
 * - specs/revamp/screens/23C_floating_panel.png
 * - specs/revamp/decisions.md (D11, D20, D26, D27, D28, D40, D41)
 * - specs/revamp/design-revalidation.md (§2 exclusions: NO p95, NO burst, NO suggested text, NO unverified claims)
 * - specs/revamp/contracts/transactions.md §4
 * - specs/revamp/contracts/commands.md §3
 */

import * as React from 'react';
import { GitBranch, Undo2, Redo2, X, Bookmark, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import type { CheckpointRecord, CommitRecord, PublicationRecord } from '../../persistence/studio';
import type { HistoryController } from './controller';
import {
  computeEvidenceSummary,
  formatCommitTime,
  formatPublicationDate,
} from './diffSummary';
import type { AheadOfVersionInfo } from './types';

export interface HistoryLadderProps {
  readonly controller?: HistoryController;
  readonly branchName?: string;
  readonly isMain?: boolean;
  readonly aheadOfVersion?: AheadOfVersionInfo | null;
  readonly workingEdits?: readonly string[];
  readonly checkpoints?: readonly Readonly<CheckpointRecord>[];
  readonly commits?: readonly Readonly<CommitRecord>[];
  readonly publications?: readonly Readonly<PublicationRecord>[];
  readonly commitDiffSummaries?: Readonly<Record<string, string | null>>;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly onSaveCheckpoint?: (label: string) => Promise<unknown> | void;
  readonly onRestore?: (snapshotIdOrCheckpointId: string) => Promise<unknown> | void;
  readonly onOpenCommit?: () => void;
  readonly onClose?: () => void;
  readonly className?: string;
}

export function HistoryLadder({
  controller,
  branchName: propBranchName,
  isMain: propIsMain,
  aheadOfVersion: propAheadOfVersion,
  workingEdits: propWorkingEdits,
  checkpoints: propCheckpoints,
  commits: propCommits,
  publications: propPublications,
  commitDiffSummaries: propCommitDiffSummaries,
  canUndo: propCanUndo,
  canRedo: propCanRedo,
  onUndo: propOnUndo,
  onRedo: propOnRedo,
  onSaveCheckpoint: propOnSaveCheckpoint,
  onRestore: propOnRestore,
  onOpenCommit,
  onClose,
  className,
}: HistoryLadderProps): React.JSX.Element {
  // Subscribe to controller state if provided
  const controllerState = React.useSyncExternalStore(
    controller ? controller.subscribe : () => () => {},
    controller ? controller.getState : () => null,
    controller ? controller.getState : () => null,
  );

  const branchName = propBranchName ?? controllerState?.branch?.label ?? 'main';
  const isMain = propIsMain ?? controllerState?.isMain ?? false;
  const aheadOfVersion =
    propAheadOfVersion !== undefined
      ? propAheadOfVersion
      : (controllerState?.aheadOfVersion ?? null);
  const workingEdits = propWorkingEdits ?? controllerState?.workingEdits ?? [];
  const checkpoints = propCheckpoints ?? controllerState?.checkpoints ?? [];
  const commits = propCommits ?? controllerState?.commits ?? [];
  const publications = propPublications ?? controllerState?.publications ?? [];

  // Local state for UI toggles and forms
  const [showAllEdits, setShowAllEdits] = React.useState(false);
  const [showAllCommits, setShowAllCommits] = React.useState(false);
  const [checkpointLabel, setCheckpointLabel] = React.useState('');
  const [isSavingCheckpoint, setIsSavingCheckpoint] = React.useState(false);
  const [checkpointError, setCheckpointError] = React.useState<string | null>(null);

  // Dynamic commit diff summaries cache
  const [diffSummaries, setDiffSummaries] = React.useState<Record<string, string | null>>(
    propCommitDiffSummaries ?? {},
  );

  React.useEffect(() => {
    if (propCommitDiffSummaries) {
      setDiffSummaries(propCommitDiffSummaries);
      return;
    }
    if (!controller) return;

    let isMounted = true;
    for (const commit of commits) {
      if (diffSummaries[commit.id] === undefined) {
        void controller.getCommitDiffSummary(commit.id).then((summary) => {
          if (isMounted) {
            setDiffSummaries((prev) => ({ ...prev, [commit.id]: summary }));
          }
        });
      }
    }
    return () => {
      isMounted = false;
    };
  }, [controller, commits, propCommitDiffSummaries]);

  // Checkpoint submission
  const handleSaveCheckpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = checkpointLabel.trim();
    if (!trimmed) return;

    setIsSavingCheckpoint(true);
    setCheckpointError(null);
    try {
      if (propOnSaveCheckpoint) {
        await propOnSaveCheckpoint(trimmed);
      } else if (controller) {
        const res = await controller.saveCheckpoint(trimmed);
        if (res.status === 'invalid' || res.status === 'failed') {
          const firstIssue = (res as { issues?: readonly { message: string }[] }).issues?.[0];
          setCheckpointError(firstIssue?.message ?? 'Failed to save checkpoint');
          return;
        }
      }
      setCheckpointLabel('');
    } catch (err) {
      setCheckpointError(err instanceof Error ? err.message : 'Error saving checkpoint');
    } finally {
      setIsSavingCheckpoint(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (isMain) return;
    if (propOnRestore) {
      await propOnRestore(id);
    } else if (controller) {
      await controller.restore(id);
    }
  };

  const visibleEdits = showAllEdits ? workingEdits : workingEdits.slice(0, 3);
  const visibleCommits = showAllCommits ? commits : commits.slice(0, 3);

  const mainCommitDisabledReason =
    'Main never holds edits (D40): edit main directly to create a draft';
  const mainRestoreDisabledReason =
    'Direct restore on main branch is rejected; main is changed only by publication';

  return (
    <div
      data-testid="history-ladder"
      className={cn(
        'flex flex-col h-full bg-card text-foreground rounded-panel border border-border shadow-panel overflow-hidden select-none',
        className,
      )}
    >
      {/* 1. Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <h2 className="text-base font-semibold tracking-tight text-foreground">History</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history panel"
            className="p-1 rounded-control text-muted-foreground hover:text-foreground hover:bg-sunken transition-colors"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* 2. Branch selector row */}
        <div
          data-testid="branch-selector-row"
          className="flex items-center justify-between px-3 py-2 rounded-control bg-accent/40 border border-selected-edge/30 text-sm font-medium"
        >
          <div className="flex items-center gap-2 truncate">
            <GitBranch className="size-4 text-branch shrink-0" />
            <span className="font-mono text-sm truncate text-foreground">{branchName}</span>
          </div>
          {aheadOfVersion && (
            <span
              data-testid="ahead-of-version"
              className="font-mono text-xs text-muted-foreground shrink-0 ml-2"
            >
              {aheadOfVersion.aheadCount} ahead of {aheadOfVersion.versionKey}
            </span>
          )}
        </div>

        {/* 3. NOW · NOT COMMITTED block */}
        <section aria-labelledby="now-not-committed-header" className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-muted-foreground">
            <span id="now-not-committed-header" className="font-semibold text-risk-text">
              NOW · NOT COMMITTED
            </span>
            <span data-testid="working-edits-count">
              {workingEdits.length} edit{workingEdits.length === 1 ? '' : 's'}
            </span>
          </div>

          <p className="text-[11px] text-muted-foreground italic">
            This session only: uncommitted edit history resets upon session reload
          </p>

          <div className="rounded-control border border-border bg-sunken/40 p-3 space-y-2">
            {workingEdits.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No uncommitted edits in this session</p>
            ) : (
              <ul className="space-y-1.5">
                {visibleEdits.map((editLabel, index) => {
                  const isLatest = index === 0;
                  return (
                    <li
                      key={`${editLabel}-${index}`}
                      className="flex items-center justify-between text-xs text-foreground gap-2"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-risk-text shrink-0">•</span>
                        <span className={cn('truncate', isLatest ? 'font-medium' : 'text-body')}>
                          {editLabel}
                        </span>
                      </div>
                      {isLatest && (
                        <Badge variant="risk" className="text-[10px] px-1.5 py-0">
                          LATEST
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {workingEdits.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllEdits(!showAllEdits)}
                className="text-xs text-primary hover:underline font-medium pt-1 block"
              >
                {showAllEdits ? 'Show less' : `Show all ${workingEdits.length} edits`}
              </button>
            )}

            {/* Undo / Redo controls */}
            <div className="flex items-center gap-2 pt-2 border-t border-border/60">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={propOnUndo}
                disabled={propCanUndo === false}
              >
                <Undo2 className="size-3.5 mr-1" />
                Undo
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={propOnRedo}
                disabled={propCanRedo === false}
              >
                <Redo2 className="size-3.5 mr-1" />
                Redo
              </Button>
            </div>
          </div>
        </section>

        {/* 4. CHECKPOINTS Section & Save checkpoint inline form */}
        <section aria-labelledby="checkpoints-header" className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-muted-foreground">
            <span id="checkpoints-header">CHECKPOINTS ({checkpoints.length})</span>
          </div>

          {/* Small inline form: Save checkpoint */}
          <form onSubmit={handleSaveCheckpoint} className="flex gap-2">
            <Input
              type="text"
              value={checkpointLabel}
              onChange={(e) => setCheckpointLabel(e.target.value)}
              placeholder="Save checkpoint label"
              maxLength={80}
              className="h-7 text-xs"
            />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="h-7 text-xs shrink-0"
              disabled={isSavingCheckpoint || checkpointLabel.trim().length === 0}
            >
              <Bookmark className="size-3.5 mr-1" />
              Save
            </Button>
          </form>
          {checkpointError && (
            <p className="text-xs text-risk-text font-medium">{checkpointError}</p>
          )}

          {/* Checkpoint list */}
          {checkpoints.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {checkpoints.map((cp) => (
                <li
                  key={cp.id}
                  className="flex items-center justify-between text-xs rounded-control border border-border/60 bg-sunken/20 px-2.5 py-1.5"
                >
                  <div className="flex flex-col truncate pr-2">
                    <span className="font-medium text-foreground truncate">{cp.label}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {formatCommitTime(cp.createdAt)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-primary hover:text-primary-hover shrink-0"
                    disabled={isMain}
                    title={isMain ? mainRestoreDisabledReason : undefined}
                    onClick={() => handleRestore(cp.id)}
                  >
                    <RotateCcw className="size-3 mr-1" />
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 5. COMMITS Section */}
        <section aria-labelledby="commits-header" className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono uppercase tracking-wider text-muted-foreground">
            <span id="commits-header">COMMITS ({commits.length})</span>
          </div>

          {commits.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No commits on this branch yet</p>
          ) : (
            <div className="space-y-2">
              {visibleCommits.map((commit, idx) => {
                const isHead = idx === 0;
                const fieldsChanged = diffSummaries[commit.id];
                const evidenceSummary = computeEvidenceSummary(commit);

                return (
                  <div
                    key={commit.id}
                    data-testid={`commit-card-${commit.id}`}
                    className="rounded-control border border-border bg-card p-3 space-y-1.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-baseline gap-2 truncate">
                        <span className="font-mono text-xs text-muted-foreground shrink-0">
                          {formatCommitTime(commit.createdAt)}
                        </span>
                        <span className="font-semibold text-sm text-foreground truncate">
                          {commit.message}
                        </span>
                      </div>
                      {isHead ? (
                        <Badge variant="solid" className="text-[10px] px-1.5 py-0 uppercase shrink-0">
                          Current
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-primary hover:text-primary-hover shrink-0"
                          disabled={isMain}
                          title={isMain ? mainRestoreDisabledReason : undefined}
                          onClick={() => handleRestore(commit.snapshotId)}
                        >
                          Restore
                        </Button>
                      )}
                    </div>

                    {/* Diff line: "n fields changed" only if computable via diffDocuments — else omit */}
                    {fieldsChanged && (
                      <p
                        data-testid="fields-changed-text"
                        className="text-xs text-muted-foreground font-mono"
                      >
                        {fieldsChanged}
                      </p>
                    )}

                    {/* Evidence summary: e.g. "3 scenarios passed" — NO p95 / burst */}
                    {evidenceSummary && (
                      <p
                        data-testid="evidence-summary-text"
                        className="text-xs text-primary font-medium flex items-center gap-1.5"
                      >
                        <span className="size-1.5 rounded-full bg-primary shrink-0" />
                        {evidenceSummary}
                      </p>
                    )}
                  </div>
                );
              })}

              {commits.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllCommits(!showAllCommits)}
                  className="text-xs text-primary hover:underline font-medium pt-1 block"
                >
                  {showAllCommits ? 'Show less' : `Show ${commits.length - 3} earlier commits`}
                </button>
              )}
            </div>
          )}
        </section>

        {/* 6. PUBLISHED ON MAIN Section */}
        {publications.length > 0 && (
          <section aria-labelledby="published-on-main-header" className="space-y-2">
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <span id="published-on-main-header">PUBLISHED ON MAIN</span>
            </div>
            <div className="space-y-2">
              {publications.map((pub) => (
                <div
                  key={pub.id}
                  data-testid={`publication-card-${pub.id}`}
                  className="flex items-center justify-between rounded-control border border-border bg-sunken/30 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Badge variant="neutral" className="font-mono text-xs font-semibold px-1.5">
                      {pub.versionKey}
                    </Badge>
                    <span className="font-medium text-foreground truncate">
                      {pub.metadata.title}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground shrink-0 ml-2">
                    {formatPublicationDate(pub.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 7. Footer */}
      <div className="px-4 py-3 border-t border-border bg-card space-y-2">
        <Button
          type="button"
          className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-semibold"
          disabled={isMain}
          title={isMain ? mainCommitDisabledReason : undefined}
          onClick={onOpenCommit}
        >
          Commit
          {workingEdits.length > 0 ? ` · ${workingEdits.length} edit${workingEdits.length === 1 ? '' : 's'}` : ''}
        </Button>

        {/* Disabled Publish Link per prompt */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Publishing arrives in the next step"
          className="w-full text-xs text-muted-foreground text-center py-1 cursor-not-allowed opacity-60 block select-none"
        >
          Publish draft to main
        </button>
      </div>
    </div>
  );
}
