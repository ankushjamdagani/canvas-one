import { evaluateCandidateState, publishCandidate, CandidateService, type CandidateState, type CandidateMergeBase as GenericCandidateMergeBase } from '@canvas-one/history';
import { prepareCandidateScenarios } from '@canvas-one/system-design/versioning/candidate-policy';
/**
 * In-memory Candidate Controller for System Studio.
 *
 * Covers prepare-publish, 3-way merge conflict resolution, candidate-scoped runs and
 * eligibility across branches.
 *
 * Controller-owned and in-memory only (never written to the DB; a new controller instance
 * means candidates are gone). The injected mintId produces candidate IDs, which are
 * ephemeral controller handles, not stored records.
 */

import type { Id } from '../../domain/studio/model';
import {
  computeSnapshotId,
  validateUuid,
  validateRevision,
  validateActor,
} from './primitives';
import { mergeDocuments, type MergeResult } from '../../domain/versioning/merge';
import { deepFreeze } from '../../domain/studio/freeze';
import {
  resolveConflict as resolveConflictDomain,
  ConflictResolutionError,
  type ConflictResolution,
} from '../../domain/versioning/resolve';
import type { BuildManifestVersions } from '../../domain/studio/manifest';
import {
  evaluateCandidate,
  type EvaluateCandidateResult,
} from '../../domain/versioning';
import {
  DEFAULT_BUILD_VERSIONS,
  type AuthoredResult,
  type FailedResult,
  type HistoryPublishCommand,
  type InvalidResult,
  type MissingResult,
  type StudioRepository,
} from './types';

// ============================================================================
// Types
// ============================================================================

export type CandidateMergeBase = GenericCandidateMergeBase;
export type Candidate = CandidateState<MergeResult>;

export type CandidateRepository = Pick<StudioRepository, 'loadProject' | 'loadBranch' | 'loadCommit' | 'loadSnapshot' | 'listRuns' | 'saveRun' | 'publish'>;
export type CandidateContext =
  | {
      readonly repo: CandidateRepository;
      readonly controller?: CandidateController;
    }
  | CandidateRepository;

export type PrepareCandidateParams = import('@canvas-one/history').PrepareCandidateParams;
export type CandidateValue = import('@canvas-one/history').CandidateValue;
export type PrepareCandidateResult = Exclude<import('@canvas-one/history').PrepareCandidateResult, { readonly status: 'invalid' | 'failed' }> | InvalidResult | FailedResult;

export type ResolveConflictParams = {
  readonly candidateId: Id;
  readonly conflictId: Id;
  readonly resolution: ConflictResolution;
};

export type ResolveConflictResult =
  | { readonly status: 'done'; readonly value: CandidateValue }
  | InvalidResult
  | MissingResult
  | FailedResult;

export type EvaluateCandidateOutput =
  | {
      readonly status: 'done';
      readonly eligible: boolean;
      readonly evaluation: EvaluateCandidateResult;
    }
  | (InvalidResult & { readonly eligible: false })
  | (MissingResult & { readonly eligible: false })
  | (FailedResult & { readonly eligible: false });

export type StartCandidateRunParams = import('@canvas-one/simulation-system-design/candidate-execution').StartCandidateRunParams;
export type CandidateRunOptions = import('@canvas-one/simulation-system-design/candidate-execution').CandidateRunOptions;
export type StartCandidateRunResult = import('@canvas-one/simulation-system-design/candidate-execution').StartCandidateRunResult<import('./types').FailedCode>;

export type CandidateControllerOptions = {
  readonly mintId: () => Id;
};

// ============================================================================
// CandidateController
// ============================================================================

export class CandidateController {
  // candidateId is an ephemeral controller handle, not a stored record.
  private readonly candidates: CandidateService<MergeResult, ConflictResolution>;

  constructor(options: CandidateControllerOptions) {
    if (!options || typeof options.mintId !== 'function') {
      throw new Error('CandidateControllerOptions.mintId is required');
    }
    this.candidates = new CandidateService({
      mintId: options.mintId,
      conflictIds: (merge) => merge.conflicts.map((conflict) => conflict.id),
      resolve: resolveConflictDomain,
      snapshotId: (merge) => computeSnapshotId(merge.document),
      freeze: deepFreeze,
      resolutionError: (error) => error instanceof ConflictResolutionError ? error : null,
    });
  }

  /**
   * Prepares an isolated merge candidate from common DAG ancestry.
   */
  async prepare(
    ctx: CandidateContext,
    params: PrepareCandidateParams,
  ): Promise<PrepareCandidateResult> {
    const repo = 'repo' in ctx ? ctx.repo : ctx;
    return this.candidates.prepare({ store: repo, merge: mergeDocuments }, params);
  }

  /**
   * Resolves a conflict on a candidate, yielding a new candidate while superseding the old one.
   */
  async resolveConflict(
    _ctx: CandidateContext,
    params: ResolveConflictParams,
  ): Promise<ResolveConflictResult> {
    return this.candidates.resolveConflict(params);
  }

  /**
   * Retrieves an in-memory candidate by ID, or null if not found.
   */
  get(candidateId: Id): Readonly<Candidate> | null {
    return this.candidates.get(candidateId) ?? null;
  }

  /**
   * Evaluates eligibility for a candidate against available runs in repository.
   * Readiness requires zero conflicts and no validation issues.
   */
  async evaluate(
    ctx: CandidateContext,
    candidateId: Id,
    options?: { versions?: BuildManifestVersions },
  ): Promise<EvaluateCandidateOutput> {
    const repo = 'repo' in ctx ? ctx.repo : ctx;
    return evaluateCandidateState({ getCandidate: (id) => this.candidates.get(id),
      conflictIds: (merge) => merge.conflicts.map((conflict) => conflict.id), issues: (merge) => merge.issues,
      prepare: (merge) => prepareCandidateScenarios(merge.document, options?.versions ?? DEFAULT_BUILD_VERSIONS),
      listRuns: (projectId) => repo.listRuns(projectId), evaluate: evaluateCandidate,
    }, candidateId);
  }

  /**
   * Executes a candidate run and persists the outcome atomically without altering candidate or branches.
   */
  async startCandidateRun(
    ctx: CandidateContext,
    params: StartCandidateRunParams,
    options?: CandidateRunOptions,
  ): Promise<StartCandidateRunResult> {
    const repo = 'repo' in ctx ? ctx.repo : ctx;
    const { startCandidateRun } = await import('@canvas-one/simulation-system-design/candidate-execution');
    return startCandidateRun({ artifacts: repo, getCandidate: (id) => {
      const candidate = this.candidates.get(id);
      return candidate ? { projectId: candidate.projectId, snapshotId: candidate.snapshotId, superseded: candidate.superseded,
        document: candidate.mergeState.document, conflictIds: candidate.mergeState.conflicts.map((conflict) => conflict.id), issues: candidate.mergeState.issues } : null;
    } }, params, options);
  }

  /**
   * Publishes an eligible candidate to main.
   *
   * Candidates are controller-owned and can't come from portable input, so publish
   * goes through CandidateController.publish(ctx, command): it looks up the candidate
   * (unknown -> missing, superseded -> failed/ineligible, conflicts/issues -> failed/conflict / invalid),
   * then hands the repository a publish ticket minted in a module-private WeakMap registry
   * bound to the candidate's IDs, tokens, snapshotId and merged document.
   * The repository rejects any ticket not found in the registry.
   */
  async publish(
    ctx: CandidateContext,
    command: HistoryPublishCommand,
  ): Promise<AuthoredResult> {
    const repo = 'repo' in ctx ? ctx.repo : ctx;
    return publishCandidate({ getCandidate: (id) => this.candidates.get(id),
      conflictIds: (merge) => merge.conflicts.map((conflict) => conflict.id), issues: (merge) => merge.issues,
      document: (merge) => merge.document, validateUuid, validateRevision, validateActor,
      publish: (ticket, published) => repo.publish(ticket, published),
    }, command);
  }

}

// ============================================================================
// Factory
// ============================================================================

export function createCandidateController(
  options: CandidateControllerOptions,
): CandidateController {
  return new CandidateController(options);
}
