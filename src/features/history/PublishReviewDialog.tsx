/**
 * PublishReviewDialog (22C publish review) — RV-11b review round.
 *
 * specs/revamp/screens/22C_publish_review.png: a modal with five numbered
 * sections — (1) What goes onto main, (2) Run evidence for exactly this state
 * (REQUIRED), (3) Conflicts with main (blocks publishing), (4) Version number
 * (major/minor/patch radio cards), (5) title/rationale/ticket URL — and a
 * footer with "Close this draft after publishing", Cancel and "Publish X.Y.Z".
 *
 * design-revalidation.md §2 overrides, deliberately absent here:
 * - "minor · fits the diff" (or any) reasoning text on a version card — the
 *   cards show only the computed number and the word major/minor/patch.
 * - p95/burst/"vs 2.2.1" deltas anywhere in the evidence or commit list.
 *
 * `PublishReviewBody` is the pure, presentational content — exported
 * separately so it can be rendered and asserted on directly with
 * renderToStaticMarkup (Radix's Dialog only mounts its Portal content on the
 * client, so nothing inside `<Dialog>` shows up in static server markup).
 * `PublishReviewDialog` is the real composition other code should mount: the
 * same body inside the project's actual Dialog primitive.
 */

import * as React from "react";
import { AlertTriangle, Check, Play } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Checkbox } from "../../components/ui/checkbox";
import { Badge } from "../../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import type { Document, Id } from "../../domain/studio/model";
import type { CommitRecord } from "../../persistence/studio";
import type { MergeConflict } from "../../domain/versioning/merge";
import type {
  VersionBumpKind,
  VersionSuggestions,
} from "../../domain/versioning/publication";
import {
  scenarioStatusLabel,
  type ScenarioWithStatus,
} from "../runs/scenarioStatus";
import { computeEvidenceSummary, formatCommitTime } from "./diffSummary";
import { findRecordLabelAcrossDocuments } from "./diffSummary";

export interface PublishReviewBodyProps {
  readonly sourceBranchLabel: string | null;
  readonly mainBranchLabel: string | null;
  readonly commitsSinceFork: readonly Readonly<CommitRecord>[];
  readonly componentsTouchedCount: number;
  readonly conflicts: readonly Readonly<MergeConflict>[];
  readonly mergeInputs: {
    readonly base: Document;
    readonly ours: Document;
    readonly theirs: Document;
  } | null;
  readonly scenarios: readonly ScenarioWithStatus[];
  readonly eligible: boolean;
  readonly runningScenarioId: Id | null;
  readonly onRunScenario: (scenarioId: Id) => void;
  readonly onOpenCompare: () => void;
  readonly versionSuggestions: VersionSuggestions | null;
  readonly currentVersionKey: string | null;
  readonly selectedBump: VersionBumpKind | null;
  readonly onSelectBump: (kind: VersionBumpKind) => void;
  readonly title: string;
  readonly onTitleChange: (value: string) => void;
  readonly rationale: string;
  readonly onRationaleChange: (value: string) => void;
  readonly ticketUrl: string;
  readonly ticketUrlValid: boolean;
  readonly onTicketUrlChange: (value: string) => void;
  readonly closeSourceAfterPublish: boolean;
  readonly onCloseSourceAfterPublishChange: (value: boolean) => void;
  readonly confirming: boolean;
  readonly isPublishing: boolean;
  readonly formError: string | null;
  readonly onCancel?: () => void;
  readonly onRequestConfirm: () => void;
  readonly onCancelConfirm: () => void;
  readonly onConfirmPublish: () => void;
  readonly className?: string;
}

export function PublishReviewBody({
  sourceBranchLabel,
  mainBranchLabel,
  commitsSinceFork,
  componentsTouchedCount,
  conflicts,
  mergeInputs,
  scenarios,
  eligible,
  runningScenarioId,
  onRunScenario,
  onOpenCompare,
  versionSuggestions,
  currentVersionKey,
  selectedBump,
  onSelectBump,
  title,
  onTitleChange,
  rationale,
  onRationaleChange,
  ticketUrl,
  ticketUrlValid,
  onTicketUrlChange,
  closeSourceAfterPublish,
  onCloseSourceAfterPublishChange,
  confirming,
  isPublishing,
  formError,
  onCancel,
  onRequestConfirm,
  onCancelConfirm,
  onConfirmPublish,
  className,
}: PublishReviewBodyProps): React.JSX.Element {
  const [showAllCommits, setShowAllCommits] = React.useState(false);
  const visibleCommits = showAllCommits
    ? commitsSinceFork
    : commitsSinceFork.slice(0, 3);

  const conflictedRecordLabels = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of conflicts) {
      const key = `${c.recordKind}:${c.recordId}`;
      if (seen.has(key)) continue;
      if (!mergeInputs)
        throw new Error("Publish conflicts require merge inputs");
      const label = findRecordLabelAcrossDocuments(
        [mergeInputs.ours, mergeInputs.theirs, mergeInputs.base],
        c.recordKind,
        c.recordId,
      );
      if (label === null)
        throw new Error("Publish conflict record has no label");
      seen.set(key, label);
    }
    return [...seen.values()];
  }, [conflicts, mergeInputs]);

  const trimmedTitle = title.trim();
  if (sourceBranchLabel === null || mainBranchLabel === null)
    throw new Error("Publish review requires branch labels");
  const titleValid = trimmedTitle.length >= 1 && trimmedTitle.length <= 80;
  const selectedSuggestion =
    versionSuggestions?.suggestions.find((s) => s.kind === selectedBump) ??
    null;

  const blockingReason = React.useMemo(() => {
    if (conflicts.length > 0)
      return `resolve ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} first`;
    if (!eligible) return "every scenario must pass first";
    if (!selectedSuggestion) return "choose a version number";
    if (selectedSuggestion.disabled)
      return "that version number is unavailable";
    if (!titleValid) return "add a title";
    if (!ticketUrlValid) return "fix the ticket URL";
    return null;
  }, [
    conflicts.length,
    eligible,
    selectedSuggestion,
    titleValid,
    ticketUrlValid,
  ]);

  const canPublish = blockingReason === null && !isPublishing;

  return (
    <div
      data-testid="publish-review-body"
      className={cn("space-y-5", className)}
    >
      {/* 1. What goes onto main */}
      <section aria-labelledby="review-commits-header" className="space-y-2">
        <div className="flex items-center justify-between text-sm font-semibold text-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center size-4 rounded-full border border-control-border text-[10px] font-mono text-muted-foreground shrink-0">
              1
            </span>
            <span id="review-commits-header">What goes onto main</span>
          </span>
          <span className="text-xs font-mono font-normal text-muted-foreground">
            {commitsSinceFork.length} commit
            {commitsSinceFork.length === 1 ? "" : "s"} ·{" "}
            {componentsTouchedCount} component
            {componentsTouchedCount === 1 ? "" : "s"} touched
          </span>
        </div>
        <div className="rounded-control border border-border divide-y divide-border/60">
          {commitsSinceFork.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground italic">
              No commits since the fork.
            </p>
          ) : (
            visibleCommits.map((commit) => (
              <div
                key={commit.id}
                data-testid={`review-commit-${commit.id}`}
                className="flex items-center justify-between px-3 py-2 text-xs gap-2"
              >
                <div className="flex items-baseline gap-2 truncate">
                  <span className="font-mono text-muted-foreground shrink-0">
                    {formatCommitTime(commit.createdAt)}
                  </span>
                  <span className="font-medium text-foreground truncate">
                    {commit.message}
                  </span>
                </div>
                {computeEvidenceSummary(commit) && (
                  <span className="font-mono text-primary shrink-0">
                    {computeEvidenceSummary(commit)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        {commitsSinceFork.length > 3 && (
          <button
            type="button"
            onClick={() => setShowAllCommits(!showAllCommits)}
            className="text-xs text-primary hover:underline font-medium"
          >
            {showAllCommits
              ? "Show fewer"
              : `Show ${commitsSinceFork.length - 3} more`}
          </button>
        )}
      </section>

      {/* 2. Run evidence for exactly this state (REQUIRED) */}
      <section aria-labelledby="review-evidence-header" className="space-y-2">
        <div className="flex items-center justify-between text-sm font-semibold text-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center size-4 rounded-full border border-control-border text-[10px] font-mono text-muted-foreground shrink-0">
              2
            </span>
            <span id="review-evidence-header">
              Run evidence for exactly this state
            </span>
          </span>
          <Badge variant="risk" className="text-[10px] px-1.5 py-0 uppercase">
            Required
          </Badge>
        </div>
        <div className="rounded-control border border-border divide-y divide-border/60">
          {scenarios.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground italic">
              No scenarios on this candidate.
            </p>
          ) : (
            scenarios.map(({ scenario, status, latestRun }) => {
              const isPassed = status.kind === "passed";
              const isNotReady = status.kind === "not-ready";
              const isRunning = runningScenarioId === scenario.id;
              return (
                <div
                  key={scenario.id}
                  data-testid={`review-scenario-${scenario.id}`}
                  className="flex items-center justify-between px-3 py-2.5 text-xs gap-2"
                >
                  <div className="flex items-start gap-2.5 truncate">
                    <span
                      className={cn(
                        "size-2 rounded-full shrink-0 mt-1",
                        isPassed && "bg-primary",
                        status.kind === "needs-rerun" && "bg-warning",
                        status.kind === "failed" && "bg-risk-text",
                        status.kind === "not-run" && "bg-muted-foreground/40",
                        isNotReady && "bg-risk-text",
                      )}
                    />
                    <div className="flex flex-col truncate">
                      <span className="font-semibold text-foreground truncate">
                        {scenario.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground truncate">
                        {scenarioStatusLabel(status)}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {isPassed && (
                      <div className="flex items-center justify-center size-6 text-primary">
                        <Check className="size-4" strokeWidth={2.5} />
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={
                        isNotReady ||
                        runningScenarioId !== null ||
                        conflicts.length > 0 ||
                        isPublishing
                      }
                      onClick={() => onRunScenario(scenario.id)}
                    >
                      <Play className="size-3 mr-1 fill-current" />
                      {isRunning ? "Running…" : latestRun ? "Re-run" : "Run"}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* 3. Conflicts with main */}
      {conflicts.length === 0 && (
        <section
          aria-labelledby="review-conflicts-header"
          className="space-y-2"
        >
          <h3 id="review-conflicts-header" className="text-sm font-semibold">
            <span className="mr-1.5 inline-flex items-center justify-center size-4 rounded-full border border-control-border text-[10px] font-mono text-muted-foreground align-middle">
              3
            </span>
            Conflicts with main
          </h3>
          <p className="text-xs text-muted-foreground">
            No conflicts with main.
          </p>
        </section>
      )}
      {conflicts.length > 0 && (
        <section
          aria-labelledby="review-conflicts-header"
          className="space-y-2"
        >
          <div className="flex items-center justify-between text-sm font-semibold text-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center size-4 rounded-full border border-control-border text-[10px] font-mono text-muted-foreground shrink-0">
                3
              </span>
              <span id="review-conflicts-header">Conflicts with main</span>
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wide text-risk-text">
              Blocks publishing
            </span>
          </div>
          <div
            data-testid="review-conflicts-callout"
            className="flex items-center justify-between gap-3 rounded-control border border-risk-edge bg-risk-tint px-3 py-2.5"
          >
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="size-4 text-risk-text shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-risk-text">
                  {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}{" "}
                  to resolve
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  across {conflictedRecordLabels.join(", ")}
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={onOpenCompare}
            >
              Open diff view
            </Button>
          </div>
        </section>
      )}

      {/* 4. Version number */}
      <section aria-labelledby="review-version-header" className="space-y-2">
        <div className="flex items-center justify-between text-sm font-semibold text-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center size-4 rounded-full border border-control-border text-[10px] font-mono text-muted-foreground shrink-0">
              4
            </span>
            <span id="review-version-header">Version number</span>
          </span>
          <span className="text-[11px] font-mono font-normal text-muted-foreground">
            {currentVersionKey
              ? `current ${currentVersionKey}`
              : "first publication"}{" "}
            ·{" "}
            {selectedSuggestion
              ? `chosen ${selectedSuggestion.versionKey}`
              : "nothing chosen yet"}
          </span>
        </div>
        {versionSuggestions && (
          <div
            className="grid grid-cols-3 gap-2"
            role="radiogroup"
            aria-labelledby="review-version-header"
          >
            {[...versionSuggestions.suggestions]
              .sort(
                (a, b) =>
                  ["major", "minor", "patch"].indexOf(a.kind) -
                  ["major", "minor", "patch"].indexOf(b.kind),
              )
              .map((s) => (
                <label
                  key={s.kind}
                  data-testid={`review-version-card-${s.kind}`}
                  className={cn(
                    "text-left rounded-control border px-3 py-2.5 text-xs transition-colors",
                    s.disabled && "opacity-50 cursor-not-allowed",
                    selectedBump === s.kind
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-sunken",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="publication-version"
                      value={s.kind}
                      checked={selectedBump === s.kind}
                      disabled={s.disabled || isPublishing}
                      onChange={() => onSelectBump(s.kind)}
                      className="size-3.5 accent-primary shrink-0"
                    />
                    <span className="font-mono font-semibold text-sm">
                      {s.versionKey}
                    </span>
                  </div>
                  <span className="block text-[11px] text-muted-foreground capitalize mt-1">
                    {s.kind}
                  </span>
                </label>
              ))}
          </div>
        )}
      </section>

      {/* 5. Title / rationale / ticket URL */}
      <section aria-labelledby="review-metadata-header" className="space-y-2">
        <div className="text-sm font-semibold text-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center size-4 rounded-full border border-control-border text-[10px] font-mono text-muted-foreground shrink-0">
              5
            </span>
            <span id="review-metadata-header">
              What{" "}
              {selectedSuggestion
                ? selectedSuggestion.versionKey
                : "this version"}{" "}
              will say it is
            </span>
          </span>
        </div>
        <div className="space-y-2">
          <div>
            <label
              htmlFor="review-title-input"
              className="text-xs font-medium text-foreground block mb-1"
            >
              Title
            </label>
            <Input
              id="review-title-input"
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="What does this version change?"
              maxLength={80}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="review-rationale-input"
              className="text-xs font-medium text-foreground block mb-1"
            >
              Rationale
            </label>
            <Textarea
              id="review-rationale-input"
              value={rationale}
              onChange={(e) => onRationaleChange(e.target.value)}
              placeholder="Optional"
              maxLength={4000}
              className="text-sm min-h-12"
            />
          </div>
          <div>
            <label
              htmlFor="review-ticket-input"
              className="text-xs font-medium text-foreground block mb-1"
            >
              Ticket URL
            </label>
            <Input
              id="review-ticket-input"
              type="url"
              value={ticketUrl}
              onChange={(e) => onTicketUrlChange(e.target.value)}
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
        </div>
      </section>

      {formError && (
        <div className="flex items-start gap-1.5 p-2 rounded-control bg-risk-tint border border-risk-edge text-risk-text text-xs">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{formError}</span>
        </div>
      )}

      {confirming && (
        <p
          data-testid="publish-confirm-notice"
          className="text-xs text-risk-text font-medium"
        >
          This publishes {selectedSuggestion?.versionKey} to main. Publications
          can&apos;t be undone.
        </p>
      )}

      <DialogFooter className="sticky bottom-0 bg-background flex-wrap flex-row items-center sm:justify-between gap-3 pt-3 border-t border-border">
        <label className="flex items-center gap-2 text-xs text-foreground">
          <Checkbox
            checked={closeSourceAfterPublish}
            onCheckedChange={(v) => onCloseSourceAfterPublishChange(v === true)}
          />
          Close this draft after publishing
        </label>
        <div className="flex items-center gap-2">
          {blockingReason && !confirming && (
            <span
              data-testid="publish-blocking-reason"
              className="text-xs text-risk-text font-medium"
            >
              {blockingReason}
            </span>
          )}
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isPublishing}
            >
              Cancel
            </Button>
          )}
          {!confirming ? (
            <Button
              type="button"
              data-testid="publish-review-button"
              disabled={!canPublish}
              onClick={onRequestConfirm}
            >
              Publish {selectedSuggestion ? selectedSuggestion.versionKey : ""}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onCancelConfirm}
                disabled={isPublishing}
              >
                Back
              </Button>
              <Button
                type="button"
                data-testid="publish-confirm-button"
                disabled={!canPublish}
                onClick={onConfirmPublish}
              >
                {isPublishing
                  ? "Publishing…"
                  : `Confirm publish ${selectedSuggestion?.versionKey ?? ""}`}
              </Button>
            </>
          )}
        </div>
      </DialogFooter>
    </div>
  );
}

export interface PublishReviewDialogProps extends PublishReviewBodyProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** The real composition to mount: PublishReviewBody inside the project's actual
 * Dialog primitive (focus trap, title, description, focus return per
 * commands.md §7). Not exercised by renderToStaticMarkup tests — see the file
 * header — those target PublishReviewBody directly. */
export function PublishReviewDialog({
  open,
  onOpenChange,
  ...bodyProps
}: PublishReviewDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="publish-review-dialog"
        className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Publish this draft</DialogTitle>
          <DialogDescription>
            {bodyProps.sourceBranchLabel} · {bodyProps.commitsSinceFork.length}{" "}
            commit{bodyProps.commitsSinceFork.length === 1 ? "" : "s"} →{" "}
            {bodyProps.mainBranchLabel}
          </DialogDescription>
        </DialogHeader>
        <PublishReviewBody {...bodyProps} />
      </DialogContent>
    </Dialog>
  );
}
