/**
 * PublishFlow React component (RV-11b).
 *
 * Publish review, conflict resolution ("compare and resolve"), the
 * draft-behind-main notice, and the published confirmation — one flow driven by
 * PublishController's state, per:
 * - specs/revamp/design.md screen family 22C/22D/22E/22F (image assets not
 *   present in this checkout; content and gating follow the contracts below).
 * - specs/revamp/contracts/commands.md (history.prepare-publish, history.resolve-conflict, history.publish)
 * - specs/revamp/contracts/transactions.md §4 & §5
 * - specs/revamp/decisions.md D25 (sequence conflicts), D26 (no publish undo —
 *   irreversible, explicit confirm), D29 (source branch closes by default)
 */

import * as React from 'react';
import { AlertTriangle, Check, GitMerge, Play, RotateCcw, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Checkbox } from '../../components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Badge } from '../../components/ui/badge';
import type { ConflictResolution } from '../../domain/versioning/resolve';
import type { MergeConflict } from '../../domain/versioning/merge';
import type { VersionBumpKind } from '../../domain/versioning/publication';
import type { ScenarioStatus } from '../runs/scenarioStatus';
import type { PublishControllerLike } from './publishController';

export interface PublishFlowProps {
  readonly controller: PublishControllerLike;
  readonly onClose?: () => void;
  readonly className?: string;
}

function getScenarioStatusLabel(status: ScenarioStatus): string {
  switch (status.kind) {
    case 'passed':
      return 'Passed on exactly this version';
    case 'needs-rerun':
      return 'Ran on an earlier version';
    case 'failed':
      return `Failed · ${status.passedChecks} of ${status.totalChecks} checks`;
    case 'not-run':
      return 'Not run yet';
    case 'not-ready':
      return `Can't run · ${status.issues.length} issue${status.issues.length === 1 ? '' : 's'}`;
  }
}

function extractResultMessage(res: unknown): string | null {
  if (!res || typeof res !== 'object') return null;
  const r = res as { readonly issues?: readonly { readonly message: string }[]; readonly message?: string };
  if (Array.isArray(r.issues) && r.issues.length > 0) return r.issues[0].message;
  if (typeof r.message === 'string') return r.message;
  return null;
}

function describeConflictSideValue(side: { readonly present: boolean; readonly value: unknown }): string {
  if (!side.present || side.value === null) return '(absent)';
  try {
    const json = JSON.stringify(side.value);
    return json.length > 140 ? `${json.slice(0, 140)}…` : json;
  } catch {
    return '(unrepresentable value)';
  }
}

/** One conflict row: base / ours / theirs, with ours/theirs/edited actions.
 * 'edited' is offered only when the contract allows it for this conflict's
 * recordKind — resolve.ts rejects 'edited' for document-kind (title) conflicts,
 * so the whole-record edit path never applies there (D25: no guessed interleaving,
 * base/ours/theirs or explicit editing only). */
function ConflictRow({
  conflict,
  onResolve,
  isResolving,
}: {
  readonly conflict: Readonly<MergeConflict>;
  readonly onResolve: (resolution: ConflictResolution) => Promise<void>;
  readonly isResolving: boolean;
}): React.JSX.Element {
  const canEdit = conflict.recordKind !== 'document';
  const [editingText, setEditingText] = React.useState<string | null>(null);
  const [editError, setEditError] = React.useState<string | null>(null);

  const startEdit = () => {
    const seed = conflict.ours.present ? conflict.ours.value : conflict.theirs.value;
    setEditingText(seed !== undefined ? JSON.stringify(seed, null, 2) : 'null');
    setEditError(null);
  };

  const submitEdit = async () => {
    if (editingText === null) return;
    // JSON.parse's return type is `any` (not `unknown`), so this assigns to the
    // resolution's typed `record` field without a type-bypassing `as` cast; the
    // real shape check happens in resolveConflictDomain (isRecordOfKind).
    let parsed;
    try {
      parsed = JSON.parse(editingText);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Invalid JSON');
      return;
    }
    try {
      await onResolve({ kind: 'edited', record: parsed });
      setEditingText(null);
      setEditError(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not apply this edit');
    }
  };

  return (
    <div
      data-testid={`conflict-row-${conflict.id}`}
      className="rounded-control border border-risk-edge bg-risk-tint/30 p-3 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground truncate">
          {conflict.recordKind}
          {conflict.path.length > 0 ? ` · ${conflict.path.join('.')}` : ''}
        </span>
        <Badge variant="risk" className="text-[10px] px-1.5 py-0 uppercase shrink-0">
          {conflict.kind}
        </Badge>
      </div>

      <dl className="grid grid-cols-1 gap-1 text-[11px] font-mono">
        <div className="flex gap-2">
          <dt className="text-muted-foreground shrink-0 w-12">base</dt>
          <dd className="truncate text-foreground">{describeConflictSideValue(conflict.base)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground shrink-0 w-12">ours</dt>
          <dd className="truncate text-foreground">{describeConflictSideValue(conflict.ours)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground shrink-0 w-12">theirs</dt>
          <dd className="truncate text-foreground">{describeConflictSideValue(conflict.theirs)}</dd>
        </div>
      </dl>

      {editingText === null ? (
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={isResolving}
            onClick={() => onResolve({ kind: 'ours' })}
          >
            Keep ours
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={isResolving}
            onClick={() => onResolve({ kind: 'theirs' })}
          >
            Keep theirs
          </Button>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={isResolving}
              onClick={startEdit}
            >
              Edit
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5" data-testid={`conflict-edit-${conflict.id}`}>
          <Textarea
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            className="font-mono text-[11px] min-h-24"
            spellCheck={false}
          />
          {editError && <p className="text-[11px] text-risk-text font-medium">{editError}</p>}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" className="h-7 text-xs" disabled={isResolving} onClick={submitEdit}>
              Use this record
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={isResolving}
              onClick={() => {
                setEditingText(null);
                setEditError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PublishFlow({ controller, onClose, className }: PublishFlowProps): React.JSX.Element {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);

  const [hasPrepared, setHasPrepared] = React.useState(false);
  const [isResolving, setIsResolving] = React.useState(false);
  const [runningScenarioId, setRunningScenarioId] = React.useState<string | null>(null);

  const [selectedBump, setSelectedBump] = React.useState<VersionBumpKind | null>(null);
  const [title, setTitle] = React.useState('');
  const [rationale, setRationale] = React.useState('');
  const [ticketUrl, setTicketUrl] = React.useState('');
  const [keepSourceOpen, setKeepSourceOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [isPublishing, setIsPublishing] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (hasPrepared) return;
    setHasPrepared(true);
    void controller.prepare();
  }, [controller, hasPrepared]);

  React.useEffect(() => {
    if (state.versionSuggestions && selectedBump === null) {
      const proposedSuggestion = state.versionSuggestions.suggestions.find(
        (s) => s.versionKey === state.versionSuggestions?.proposedKey,
      );
      setSelectedBump(proposedSuggestion?.kind ?? null);
    }
  }, [state.versionSuggestions, selectedBump]);

  const handleResolve = React.useCallback(
    async (conflictId: string, resolution: ConflictResolution) => {
      setIsResolving(true);
      try {
        const res = await controller.resolveConflict(conflictId, resolution);
        if (res.status !== 'done') {
          throw new Error(extractResultMessage(res) ?? `Could not resolve conflict (status: ${res.status})`);
        }
      } finally {
        setIsResolving(false);
      }
    },
    [controller],
  );

  const handleRunScenario = React.useCallback(
    async (scenarioId: string) => {
      setRunningScenarioId(scenarioId);
      try {
        await controller.runScenario(scenarioId);
      } finally {
        setRunningScenarioId(null);
      }
    },
    [controller],
  );

  const selectedSuggestion = state.versionSuggestions?.suggestions.find((s) => s.kind === selectedBump) ?? null;
  const trimmedTitle = title.trim();
  const titleValid = trimmedTitle.length >= 1 && trimmedTitle.length <= 80;
  const trimmedTicketUrl = ticketUrl.trim();
  let ticketUrlValid = true;
  if (trimmedTicketUrl.length > 0) {
    try {
      const parsed = new URL(trimmedTicketUrl);
      ticketUrlValid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      ticketUrlValid = false;
    }
  }

  const totalScenarios = state.scenarios.length;
  const passingScenarios = state.scenarios.filter((s) => s.status.kind === 'passed').length;
  const anyNotReady = state.scenarios.some((s) => s.status.kind === 'not-ready');
  const hasConflicts = state.conflicts.length > 0;

  const canPublish =
    state.status === 'review' &&
    !hasConflicts &&
    state.eligible &&
    selectedSuggestion !== null &&
    !selectedSuggestion.disabled &&
    titleValid &&
    ticketUrlValid &&
    !isPublishing;

  const handlePublish = async () => {
    if (!canPublish || !selectedSuggestion) return;
    setIsPublishing(true);
    setFormError(null);
    try {
      const res = await controller.publish(
        {
          version: selectedSuggestion.version,
          title: trimmedTitle,
          rationale,
          ticketUrl: trimmedTicketUrl.length > 0 ? trimmedTicketUrl : null,
        },
        keepSourceOpen,
      );
      if (res.status !== 'applied') {
        setFormError(extractResultMessage(res) ?? `Publish failed with status: ${res.status}`);
        setConfirming(false);
        return;
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Publish failed');
      setConfirming(false);
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div
      data-testid="publish-flow"
      className={cn(
        'flex flex-col h-full bg-card text-foreground rounded-panel border border-border shadow-panel overflow-hidden select-none',
        className,
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <h2 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
          <GitMerge className="size-4 text-branch" />
          {state.status === 'published' ? 'Published' : 'Publish draft to main'}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close publish panel"
            className="p-1 rounded-control text-muted-foreground hover:text-foreground hover:bg-sunken transition-colors"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {(state.status === 'idle' || state.status === 'preparing') && (
          <p data-testid="publish-preparing" className="text-sm text-muted-foreground italic">
            Preparing an isolated candidate from main…
          </p>
        )}

        {state.status === 'error' && (
          <div className="flex items-start gap-1.5 p-2 rounded-control bg-risk-tint border border-risk-edge text-risk-text text-xs">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{extractResultMessage(state.lastError) ?? 'An unexpected error occurred'}</span>
          </div>
        )}

        {/* 22E: draft behind main */}
        {state.status === 'behind-main' && state.staleInfo && (
          <section data-testid="publish-behind-main" className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-control bg-risk-tint border border-risk-edge text-risk-text text-sm">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">This draft is behind main.</p>
                <p className="text-xs mt-1">
                  Expected {state.staleInfo.scope} revision {String(state.staleInfo.expected)}, found{' '}
                  {String(state.staleInfo.actual)}. Compare and resolve against the latest main before publishing.
                </p>
              </div>
            </div>
            <Button type="button" size="sm" onClick={() => void controller.prepare()}>
              <RotateCcw className="size-3.5 mr-1" />
              Compare and resolve
            </Button>
          </section>
        )}

        {/* Prepare blocked outright (not stale — e.g. uncommitted changes, closed branch) */}
        {state.status === 'blocked' && (
          <div data-testid="publish-blocked" className="flex items-start gap-1.5 p-2 rounded-control bg-risk-tint border border-risk-edge text-risk-text text-xs">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{state.blockedMessage ?? 'Publish is not available right now.'}</span>
          </div>
        )}

        {/* 22D: published */}
        {state.status === 'published' && state.publication && (
          <section data-testid="publish-published" className="space-y-3">
            <div className="flex items-center gap-2.5 rounded-control border border-border bg-sunken/30 px-3 py-2.5">
              <div className="flex items-center justify-center size-8 rounded-full bg-primary/15 text-primary shrink-0">
                <Check className="size-4" strokeWidth={2.5} />
              </div>
              <div className="truncate">
                <div className="flex items-center gap-2">
                  <Badge variant="neutral" className="font-mono text-xs font-semibold px-1.5">
                    {state.publication.versionKey}
                  </Badge>
                  <span className="font-medium text-foreground truncate">{state.publication.metadata.title}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Published to main. Publications can&apos;t be undone; corrections are new publications.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 22C / 22F: review, conflicts, scenario gate, metadata form */}
        {state.status === 'review' && (
          <>
            {hasConflicts && (
              <section aria-labelledby="conflicts-header" className="space-y-2">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  <span id="conflicts-header">CONFLICTS ({state.conflicts.length})</span>
                </div>
                <div className="space-y-2">
                  {state.conflicts.map((conflict) => (
                    <ConflictRow
                      key={conflict.id}
                      conflict={conflict}
                      isResolving={isResolving}
                      onResolve={(resolution) => handleResolve(conflict.id, resolution)}
                    />
                  ))}
                </div>
              </section>
            )}

            {!hasConflicts && (
              <>
                <section aria-labelledby="publish-scenarios-header" className="space-y-2">
                  <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    <span id="publish-scenarios-header">EVERY SCENARIO MUST PASS ON THIS VERSION</span>
                  </div>
                  <div className="rounded-control border border-border bg-sunken/40 divide-y divide-border/60">
                    {totalScenarios === 0 ? (
                      <p className="p-3 text-xs text-muted-foreground italic">No scenarios in this document.</p>
                    ) : (
                      state.scenarios.map(({ scenario, status }) => {
                        const isPassed = status.kind === 'passed';
                        const isNotReady = status.kind === 'not-ready';
                        const isRunning = runningScenarioId === scenario.id;
                        return (
                          <div
                            key={scenario.id}
                            data-testid={`publish-scenario-row-${scenario.id}`}
                            className="flex items-center justify-between px-3 py-2.5 text-xs gap-2"
                          >
                            <div className="flex items-start gap-2.5 truncate">
                              <span
                                className={cn(
                                  'size-2 rounded-full shrink-0 mt-1',
                                  isPassed && 'bg-primary',
                                  status.kind === 'needs-rerun' && 'bg-amber-600',
                                  status.kind === 'failed' && 'bg-risk-text',
                                  status.kind === 'not-run' && 'bg-muted-foreground/40',
                                  isNotReady && 'bg-risk-text',
                                )}
                              />
                              <div className="flex flex-col truncate">
                                <span className="font-semibold text-foreground truncate">{scenario.label}</span>
                                <span className="text-[11px] text-muted-foreground truncate">
                                  {getScenarioStatusLabel(status)}
                                </span>
                              </div>
                            </div>
                            <div className="shrink-0">
                              {isPassed ? (
                                <div className="flex items-center justify-center size-6 text-primary">
                                  <Check className="size-4" strokeWidth={2.5} />
                                </div>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2.5 text-xs"
                                  disabled={isNotReady || isRunning}
                                  onClick={() => void handleRunScenario(scenario.id)}
                                >
                                  <Play className="size-3 mr-1 fill-current" />
                                  {isRunning ? 'Running…' : 'Run'}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {totalScenarios > 0 && (
                    <span data-testid="publish-passing-summary" className="font-mono text-xs text-muted-foreground block">
                      {passingScenarios} of {totalScenarios} passing
                    </span>
                  )}
                  {anyNotReady && (
                    <p className="text-xs text-risk-text font-medium">Some scenarios can&apos;t run yet.</p>
                  )}
                </section>

                <section aria-labelledby="publish-version-header" className="space-y-2">
                  <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    <span id="publish-version-header">VERSION</span>
                  </div>
                  {state.versionSuggestions && (
                    <RadioGroup
                      value={selectedBump ?? undefined}
                      onValueChange={(v) => setSelectedBump(v as VersionBumpKind)}
                      className="grid grid-cols-1 gap-1.5"
                    >
                      {state.versionSuggestions.suggestions.map((s) => (
                        <label
                          key={s.kind}
                          data-testid={`version-suggestion-${s.kind}`}
                          className={cn(
                            'flex items-center gap-2 rounded-control border border-border px-2.5 py-1.5 text-xs',
                            s.disabled && 'opacity-50',
                          )}
                        >
                          <RadioGroupItem value={s.kind} disabled={s.disabled} />
                          <span className="font-mono font-semibold">{s.versionKey}</span>
                          <span className="text-muted-foreground capitalize">{s.kind}</span>
                          {s.versionKey === state.versionSuggestions?.proposedKey && (
                            <Badge variant="neutral" className="text-[10px] px-1.5 py-0 ml-auto">
                              Proposed
                            </Badge>
                          )}
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                </section>

                <section aria-labelledby="publish-metadata-header" className="space-y-2">
                  <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    <span id="publish-metadata-header">PUBLICATION</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label htmlFor="publish-title-input" className="text-xs font-medium text-foreground block mb-1">
                        Title
                      </label>
                      <Input
                        id="publish-title-input"
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="What does this version change?"
                        maxLength={80}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="publish-rationale-input" className="text-xs font-medium text-foreground block mb-1">
                        Description
                      </label>
                      <Textarea
                        id="publish-rationale-input"
                        value={rationale}
                        onChange={(e) => setRationale(e.target.value)}
                        placeholder="Optional"
                        maxLength={4000}
                        className="text-sm min-h-16"
                      />
                    </div>
                    <div>
                      <label htmlFor="publish-ticket-input" className="text-xs font-medium text-foreground block mb-1">
                        Ticket URL
                      </label>
                      <Input
                        id="publish-ticket-input"
                        type="url"
                        value={ticketUrl}
                        onChange={(e) => setTicketUrl(e.target.value)}
                        placeholder="https:// (optional)"
                        aria-invalid={!ticketUrlValid}
                        className="h-8 text-sm"
                      />
                      {!ticketUrlValid && (
                        <p className="text-[11px] text-risk-text font-medium mt-1">
                          Ticket URL must be an absolute http(s) link.
                        </p>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-foreground pt-1">
                      <Checkbox
                        checked={keepSourceOpen}
                        onCheckedChange={(v) => setKeepSourceOpen(v === true)}
                      />
                      Keep the source branch open after publishing
                    </label>
                  </div>
                </section>

                {formError && (
                  <div className="flex items-start gap-1.5 p-2 rounded-control bg-risk-tint border border-risk-edge text-risk-text text-xs">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {state.status === 'review' && !hasConflicts && (
        <div className="px-4 py-3 border-t border-border bg-card space-y-2">
          {!confirming ? (
            <Button
              type="button"
              data-testid="publish-review-button"
              className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-semibold"
              disabled={!canPublish}
              onClick={() => setConfirming(true)}
            >
              Publish {selectedSuggestion ? selectedSuggestion.versionKey : ''}
            </Button>
          ) : (
            <div data-testid="publish-confirm" className="space-y-2">
              <p className="text-xs text-risk-text font-medium">
                This publishes {selectedSuggestion?.versionKey} to main. Publications can&apos;t be undone.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  className="flex-1 bg-primary hover:bg-primary-hover text-primary-foreground font-semibold"
                  disabled={!canPublish || isPublishing}
                  onClick={() => void handlePublish()}
                >
                  {isPublishing ? 'Publishing…' : 'Confirm publish'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={isPublishing}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
