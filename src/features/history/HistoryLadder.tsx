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
import { GitBranch, Undo2, Redo2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import type { CommitRecord, PublicationRecord } from '../../persistence/studio';
import type { HistoryControllerLike } from './controller';
import {
  computeEvidenceSummary,
  formatCommitTime,
  formatPublicationDate,
} from './diffSummary';
import type { AheadOfVersionInfo } from './types';
import { requireResultMessage, ResultMessageContractError } from './resultMessage';

export interface HistoryLadderProps {
  readonly controller?: HistoryControllerLike;
  readonly branchName?: string;
  readonly isMain?: boolean;
  readonly aheadOfVersion?: AheadOfVersionInfo | null;
  readonly workingEdits?: readonly string[];
  readonly commits?: readonly Readonly<CommitRecord>[];
  readonly publications?: readonly Readonly<PublicationRecord>[];
  readonly commitDiffSummaries?: Readonly<Record<string, string | null>>;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly onRestore?: (snapshotIdOrCheckpointId: string, label: string) => Promise<unknown> | void;
  readonly onOpenCommit?: () => void;
  readonly onOpenPublish?: () => void;
  /** Registry availability reasons (draft open, closed branch, storage failing…). */
  readonly commitBlockedReason?: string | null;
  readonly publishBlockedReason?: string | null;
  /** Set once a real prepare-publish has run and found the draft behind main
   * (22E) — never invented; omitted/null shows the plain Publish affordance. */
  readonly behindMain?: { readonly conflictCount: number; readonly versionsPublishedSinceFork: number } | null;
  readonly onReviewAndResolve?: () => void;
  readonly onStartDraft?: (publication: Readonly<PublicationRecord>) => void;
  readonly onEditMain?: () => void;
  readonly onComparePublication?: (publication: Readonly<PublicationRecord>) => void;
  readonly onClose?: () => void;
  readonly filterIds?: readonly string[];
  readonly onClearFilter?: () => void;
  readonly className?: string;
  /** PanelHost already supplies the panel title, controls, and outer chrome. */
  readonly hosted?: boolean;
}

export function HistoryLadder({
  controller,
  branchName: propBranchName,
  isMain: propIsMain,
  aheadOfVersion: propAheadOfVersion,
  workingEdits: propWorkingEdits,
  commits: propCommits,
  publications: propPublications,
  commitDiffSummaries: propCommitDiffSummaries,
  canUndo: propCanUndo,
  canRedo: propCanRedo,
  onUndo: propOnUndo,
  onRedo: propOnRedo,
  onRestore: propOnRestore,
  onOpenCommit,
  onOpenPublish,
  commitBlockedReason,
  publishBlockedReason,
  behindMain,
  onReviewAndResolve,
  onStartDraft,
  onEditMain,
  onComparePublication,
  onClose,
  filterIds,
  onClearFilter,
  className,
  hosted = false,
}: HistoryLadderProps): React.JSX.Element {
  // Subscribe to controller state if provided
  const controllerState = React.useSyncExternalStore(
    controller ? controller.subscribe : () => () => {},
    controller ? controller.getState : () => null,
    controller ? controller.getState : () => null,
  );

  // No invented default: branch name comes only from the prop or the controller's
  // real branch record. If neither is present yet (e.g. history still loading), the
  // branch row is omitted rather than showing a made-up name.
  const branchName = propBranchName ?? controllerState?.branch?.label ?? null;
  const isMain = propIsMain ?? controllerState?.isMain ?? false;
  const aheadOfVersion =
    propAheadOfVersion !== undefined
      ? propAheadOfVersion
      : (controllerState?.aheadOfVersion ?? null);
  const workingEdits = propWorkingEdits ?? controllerState?.workingEdits ?? [];
  const commits = propCommits ?? controllerState?.commits ?? [];
  const publications = propPublications ?? controllerState?.publications ?? [];
  const orderedPublications = [...publications].sort((a, b) => b.ordinal - a.ordinal);

  const [matchingCommits, setMatchingCommits] = React.useState<ReadonlySet<string> | null>(null);
  React.useEffect(() => {
    if (!filterIds || filterIds.length === 0) {
      setMatchingCommits(null);
      return;
    }
    if (controller) {
      let isMounted = true;
      void controller.getCommitsTouching(filterIds).then((matching) => {
        if (isMounted) setMatchingCommits(matching);
      });
      return () => { isMounted = false; };
    }
  }, [filterIds, controller]);

  const displayCommits = React.useMemo(() => {
    if (!matchingCommits) return commits;
    return commits.filter(c => matchingCommits.has(c.id));
  }, [commits, matchingCommits]);

  const currentPublication = orderedPublications[0];
  const publishedMain = isMain && currentPublication !== undefined;

  // Local state for UI toggles and forms
  const [showAllEdits, setShowAllEdits] = React.useState(false);
  const [showAllCommits, setShowAllCommits] = React.useState(false);

  // Restore confirmation: which commit snapshotId has its inline "pre-restore
  // checkpoint label" field open. No label is ever prefilled — Confirm stays
  // disabled until the person types one.
  const [restoreTargetId, setRestoreTargetId] = React.useState<string | null>(null);
  const [restoreLabel, setRestoreLabel] = React.useState('');
  const [isRestoring, setIsRestoring] = React.useState(false);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);

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

  // Restore requires its own pre-restore checkpoint label (commands.md
  // history.restore payload {snapshotId, checkpointId, label}) — never invented,
  // always collected from the person via the inline field below.
  const beginRestore = (id: string) => {
    if (isMain) return;
    setRestoreTargetId(id);
    setRestoreLabel('');
    setRestoreError(null);
  };

  const cancelRestore = () => {
    setRestoreTargetId(null);
    setRestoreLabel('');
    setRestoreError(null);
  };

  const confirmRestore = async (id: string) => {
    const trimmed = restoreLabel.trim();
    if (!trimmed) return;

    setIsRestoring(true);
    setRestoreError(null);
    try {
      if (propOnRestore) {
        await propOnRestore(id, trimmed);
      } else if (controller) {
        const res = await controller.restore(id, trimmed);
        if (res.status !== 'applied') {
          setRestoreError(requireResultMessage(res));
          return;
        }
      }
      setRestoreTargetId(null);
      setRestoreLabel('');
    } catch (err) {
      if (err instanceof ResultMessageContractError) throw err;
      setRestoreError(requireResultMessage(err));
    } finally {
      setIsRestoring(false);
    }
  };

  const visibleEdits = showAllEdits ? workingEdits : workingEdits.slice(0, 3);
  const visibleCommits = showAllCommits ? displayCommits : displayCommits.slice(0, 3);

  const mainCommitDisabledReason =
    'Main never holds edits (D40): edit main directly to create a draft';
  const mainRestoreDisabledReason =
    'Direct restore on main branch is rejected; main is changed only by publication';

  // Restore needs its own pre-restore checkpoint label; this inline form is used
  // by commit cards.
  const renderRestoreForm = (id: string) => (
    <div className="flex flex-col items-end gap-1 shrink-0" data-testid={`restore-confirm-${id}`}>
      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          autoFocus
          value={restoreLabel}
          onChange={(e) => setRestoreLabel(e.target.value)}
          placeholder="Checkpoint label for current work"
          maxLength={80}
          className="h-6 text-[11px] w-40"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={isRestoring || restoreLabel.trim().length === 0}
          onClick={() => confirmRestore(id)}
        >
          Confirm
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={isRestoring}
          onClick={cancelRestore}
        >
          Cancel
        </Button>
      </div>
      {restoreError && <p className="text-[11px] text-risk-text font-medium">{restoreError}</p>}
    </div>
  );

  const restoreLink = (id: string) => (
    <button
      type="button"
      className="shrink-0 text-xs font-medium text-primary hover:text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      disabled={isMain}
      title={isMain ? mainRestoreDisabledReason : undefined}
      onClick={() => beginRestore(id)}
    >
      Restore
    </button>
  );

  return (
    <div
      data-testid="history-ladder"
      className={cn(
        'flex flex-col h-full bg-panel text-foreground overflow-hidden select-none',
        hosted ? 'rounded-none border-0 shadow-none' : 'rounded-panel border border-border shadow-panel',
        className,
      )}
    >
      {/* 1. Header */}
      {!hosted && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
          <h2 className="text-base font-semibold text-foreground">History</h2>
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
      )}

      {/* 2. Branch selector row (22A: sits in the white header block) — omitted
       * entirely when no real branch name is known */}
      {branchName && (
        <div className="shrink-0 border-b border-border bg-background px-4 pb-3 pt-1">
          <div
            data-testid="branch-selector-row"
            className="flex h-9 items-center justify-between gap-2 rounded-control border border-branch-edge bg-branch-tint px-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <GitBranch className="size-3.5 shrink-0 text-branch" aria-hidden="true" />
              <span className="truncate text-[13px] font-semibold text-branch">{branchName}</span>
            </div>
            {aheadOfVersion && (
              <span
                data-testid="ahead-of-version"
                className="shrink-0 font-mono text-[11px] text-secondary-text"
              >
                {aheadOfVersion.aheadCount} ahead of {aheadOfVersion.versionKey}
              </span>
            )}
            {publishedMain && <span className="text-xs font-mono text-primary">up to date · {currentPublication.versionKey}</span>}
          </div>
        </div>
      )}

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-4 space-y-5">
        {/* 2b. "This draft is behind main" callout (22E) — shown only once a real
         * prepare-publish has found the draft behind main (never inferred). */}
        {behindMain && (
          <div
            data-testid="ladder-behind-main"
            className="rounded-control border border-risk-edge bg-risk-tint px-3 py-2.5 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-risk-text">This draft is behind main</p>
              {onReviewAndResolve && (
                <button type="button" onClick={onReviewAndResolve} className="text-xs font-medium text-primary hover:underline shrink-0">
                  Review
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {behindMain.versionsPublishedSinceFork} version{behindMain.versionsPublishedSinceFork === 1 ? '' : 's'} published
              since you forked
            </p>
          </div>
        )}

        {/* 3. NOW · NOT COMMITTED block (22A) */}
        {!publishedMain && (!behindMain || workingEdits.length > 0) && (
          <section aria-labelledby="now-not-committed-header" className="space-y-2">
            <div className="flex items-center justify-between font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-secondary-text">
              <span id="now-not-committed-header" className="text-risk-text">
                NOW · NOT COMMITTED
              </span>
              <span data-testid="working-edits-count" className="normal-case tracking-normal text-[11px]">
                {workingEdits.length} edit{workingEdits.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="sr-only">This session only: uncommitted edit history resets upon session reload</p>

            <div className="rounded-control border border-border bg-background overflow-hidden">
              <div className="p-1.5">
                {workingEdits.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">No uncommitted edits in this session</p>
                ) : (
                  <ul className="space-y-0.5">
                    {visibleEdits.map((editLabel, index) => {
                      const isLatest = index === 0;
                      return (
                        <li
                          key={`${editLabel}-${index}`}
                          className={cn(
                            'flex items-center justify-between gap-2 rounded-[6px] px-2.5 py-2 text-[13px]',
                            isLatest ? 'bg-risk-tint text-foreground' : 'text-body',
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              aria-hidden="true"
                              className={cn('size-1.5 rounded-full shrink-0', isLatest ? 'bg-risk-text' : 'bg-border')}
                            />
                            <span className={cn('truncate', isLatest && 'font-semibold')}>{editLabel}</span>
                          </div>
                          {isLatest && (
                            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-risk-text shrink-0">
                              Latest
                            </span>
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
                    className="block px-2 pt-2 pb-1 text-xs font-medium text-primary hover:underline cursor-pointer"
                  >
                    {showAllEdits ? 'Show less' : `Show all ${workingEdits.length} edits`}
                  </button>
                )}
              </div>

              {/* Undo / Redo controls */}
              <div className="flex items-center gap-2 border-t border-hairline bg-panel px-2.5 py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
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
                  className="h-7 px-2.5 text-xs"
                  onClick={propOnRedo}
                  disabled={propCanRedo === false}
                >
                  <Redo2 className="size-3.5 mr-1" />
                  Redo
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* 4. COMMITS Section */}
        {!publishedMain && (
          <section aria-labelledby="commits-header" className="space-y-2">
            {filterIds && filterIds.length > 0 && (
              <div data-testid="history-filter-chip" className="inline-flex min-h-8 items-center gap-2 rounded-full border border-control-border bg-sunken px-3 text-xs text-ink">
                <span>{filterIds.length === 1 ? 'Changes on selected part' : `Changes on ${filterIds.length} selected parts`}</span>
                <button type="button" className="rounded px-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label="Clear history filter" onClick={onClearFilter}>×</button>
              </div>
            )}
            <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-secondary-text">
              <span id="commits-header">COMMITS ({displayCommits.length})</span>
            </div>

            {displayCommits.length === 0 ? (
              <p className="text-xs text-muted-foreground">No commits on this branch yet</p>
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
                      className="rounded-control border border-border bg-background overflow-hidden"
                    >
                      <div className="flex items-start gap-2.5 px-3 py-2.5">
                        <span className="font-mono text-[11px] text-secondary-text shrink-0 pt-[3px]">
                          {formatCommitTime(commit.createdAt)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className={cn('text-[13px] text-foreground', isHead ? 'font-semibold' : 'font-medium')}>
                              {commit.message}
                            </span>
                            {isHead ? (
                              <span className="inline-flex h-4 shrink-0 items-center rounded-tag bg-primary px-1.5 text-[9.5px] font-semibold text-primary-foreground">
                                Current
                              </span>
                            ) : restoreTargetId === commit.snapshotId ? null : (
                              restoreLink(commit.snapshotId)
                            )}
                          </div>
                          {/* Diff line: "n fields changed" only if computable via diffDocuments — else omit */}
                          {fieldsChanged && (
                            <p
                              data-testid="fields-changed-text"
                              className="mt-0.5 font-mono text-[10.5px] text-secondary-text"
                            >
                              {fieldsChanged}
                            </p>
                          )}
                        </div>
                      </div>
                      {!isHead && restoreTargetId === commit.snapshotId && (
                        <div className="border-t border-hairline px-3 py-2">{renderRestoreForm(commit.snapshotId)}</div>
                      )}

                      {/* Evidence summary: e.g. "3 scenarios passed" — NO p95 / burst */}
                      {evidenceSummary && (
                        <div className="border-t border-hairline bg-panel px-3 py-2">
                          <p
                            data-testid="evidence-summary-text"
                            className="font-mono text-[10.5px] text-primary flex items-center gap-1.5"
                          >
                            <span className="size-1.5 rounded-full bg-primary shrink-0" />
                            {evidenceSummary}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {displayCommits.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowAllCommits(!showAllCommits)}
                    className="block text-xs font-medium text-primary hover:underline cursor-pointer"
                  >
                    {showAllCommits ? 'Show less' : `Show ${displayCommits.length - 3} earlier commits`}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* 6. PUBLISHED ON MAIN Section */}
        {publications.length > 0 && (
          <section aria-labelledby="published-on-main-header" className="space-y-2">
            <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-secondary-text">
              <span id="published-on-main-header">PUBLISHED ON MAIN</span>
            </div>
            <div className="space-y-2">
              {orderedPublications.map((pub, index) => (
                <div
                  key={pub.id}
                  data-testid={`publication-card-${pub.id}`}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-control border px-3 py-2.5 text-sm',
                    index === 0 && isMain ? 'border-primary bg-background ring-2 ring-primary/10' : 'border-border bg-sunken',
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Badge variant="accent" className="font-mono text-[10px] font-semibold px-1.5 py-0 h-4 shrink-0 normal-case tracking-normal">
                      {pub.versionKey}
                    </Badge>
                    <div className="min-w-0">
                      <span className="block text-[13px] font-medium text-foreground truncate">{pub.metadata.title}</span>
                      <p className="font-mono text-[10.5px] text-secondary-text">{formatPublicationDate(pub.createdAt)}</p>
                      {commits.find((commit) => commit.id === pub.commitId)?.evidence.length ? <p className="text-[10px] font-mono text-primary">REFERENCE · {computeEvidenceSummary(commits.find((commit) => commit.id === pub.commitId)!)}</p> : null}
                    </div>
                  </div>
                  <span className="font-mono text-[10.5px] text-secondary-text shrink-0">
                    {index === 0 && isMain ? 'CURRENT' : null}
                    {index > 0 && onComparePublication && <button type="button" className="ml-2 text-primary" onClick={() => onComparePublication(pub)}>Compare</button>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 7. Footer */}
      <div className="px-4 py-3 border-t border-border bg-background space-y-2">
        {publishedMain ? <>
          <Button type="button" className="w-full" disabled={!onStartDraft} onClick={() => onStartDraft?.(currentPublication)}>Start a new draft from {currentPublication.versionKey}</Button>
          <button type="button" className="text-xs text-primary disabled:text-muted-foreground" disabled={!onEditMain} onClick={onEditMain}>Edit main directly</button>
          <span className="text-[10px] text-muted-foreground ml-2">creates a draft on first edit</span>
        </> : <>
        {!behindMain && <Button
          type="button"
          className="w-full h-11 bg-primary hover:bg-primary-hover text-primary-foreground font-semibold"
          disabled={isMain || Boolean(commitBlockedReason)}
          title={isMain ? mainCommitDisabledReason : (commitBlockedReason ?? undefined)}
          onClick={onOpenCommit}
        >
          Commit
          {workingEdits.length > 0 ? ` · ${workingEdits.length} edit${workingEdits.length === 1 ? '' : 's'}` : ''}
        </Button>}

        {/* Publish affordance: opens PublishFlow (RV-11b). Disabled on main (D40)
         * and while the branch has no committed head yet (prepare-publish
         * requires a committed source head per transactions.md §4). When the
         * draft is known behind main (22E), the primary action becomes
         * reviewing the real conflict count instead. */}
        {behindMain ? (
          <>
            {onReviewAndResolve && (
              <Button type="button" className="w-full font-semibold" onClick={onReviewAndResolve}>
                Review and resolve {behindMain.conflictCount} conflict{behindMain.conflictCount === 1 ? '' : 's'}
              </Button>
            )}
            <p className="text-xs text-muted-foreground text-center py-1">Publish draft to main — blocked until updated</p>
          </>
        ) : (
          <button
            type="button"
            data-testid="open-publish-button"
            disabled={isMain || commits.length === 0 || !onOpenPublish || Boolean(publishBlockedReason)}
            aria-disabled={isMain || commits.length === 0 || !onOpenPublish || Boolean(publishBlockedReason)}
            title={
              isMain
                ? mainCommitDisabledReason
                : commits.length === 0
                  ? 'Commit at least once before publishing'
                  : (publishBlockedReason ?? undefined)
            }
            onClick={onOpenPublish}
            className={cn(
              'block text-xs text-left py-1 pointer-coarse:min-h-11 select-none',
              isMain || commits.length === 0 || !onOpenPublish || publishBlockedReason
                ? 'text-muted-foreground cursor-not-allowed opacity-60'
                : 'text-primary hover:underline font-medium cursor-pointer',
            )}
          >
            Publish draft to main
          </button>
        )}
        </>}
      </div>
    </div>
  );
}
