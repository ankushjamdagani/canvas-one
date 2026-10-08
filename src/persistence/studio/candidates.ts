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
import { createIssue } from './errors';
import {
  findMergeBase,
  type MergeBaseResult,
} from '../../domain/versioning/merge-base';
import { mergeDocuments, type MergeResult } from '../../domain/versioning/merge';
import { deepFreeze } from '../../domain/studio/freeze';
import {
  resolveConflict as resolveConflictDomain,
  ConflictResolutionError,
  type ConflictResolution,
} from '../../domain/versioning/resolve';
import {
  buildManifest,
  type BuildManifestVersions,
} from '../../domain/studio/manifest';
import {
  evaluateCandidate,
  type CandidateScenario,
  type EvaluateCandidateResult,
} from '../../domain/versioning';
import type {
  ScenarioRunnerOptions,
  ScenarioRunResult,
} from '../../domain/studio/runner/scenario-runner';
import { mintRunStartToken } from './token';
import { mintPublishTicket } from './publish-ticket';
import {
  DEFAULT_BUILD_VERSIONS,
  type AuthoredResult,
  type ExpectedHead,
  type FailedResult,
  type HistoryPublishCommand,
  type InvalidResult,
  type MissingResult,
  type SaveRunResult,
  type StaleResult,
  type StudioRepository,
} from './types';
import type { Issue } from '../../domain/studio/validate';
import { manifestFailureIssues } from './manifest-issues';

// ============================================================================
// Types
// ============================================================================

export type CandidateMergeBase = {
  readonly commitId: Id | null;
  readonly snapshotId: string;
};

export type Candidate = {
  // candidateId is an ephemeral controller handle, not a stored record.
  readonly candidateId: Id;
  readonly projectId: Id;
  readonly sourceBranchId: Id;
  readonly mainBranchId: Id;
  readonly expectedSourceRevision: number;
  readonly expectedSourceHeadId: ExpectedHead;
  readonly expectedMainRevision: number;
  readonly expectedMainHeadId: ExpectedHead;
  readonly mergeBase: CandidateMergeBase;
  readonly snapshotId: string;
  readonly mergeState: MergeResult;
  readonly superseded: boolean;
};

export type CandidateContext =
  | {
      readonly repo: StudioRepository;
      readonly controller?: CandidateController;
    }
  | StudioRepository;

export type PrepareCandidateParams = {
  readonly projectId: Id;
  readonly sourceBranchId: Id;
  readonly sourceRevision: number;
  readonly sourceHeadId: ExpectedHead;
  readonly mainRevision: number;
  readonly mainHeadId: ExpectedHead;
};

export type CandidateValue = {
  readonly kind: 'candidate';
  readonly candidateId: Id;
  readonly snapshotId: string;
  readonly conflictIds: readonly Id[];
};

export type PrepareCandidateResult =
  | { readonly status: 'done'; readonly value: CandidateValue }
  | InvalidResult
  | StaleResult
  | MissingResult
  | FailedResult;

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

export type StartCandidateRunParams = {
  readonly candidateId: Id;
  readonly scenarioId: Id;
  readonly runId: Id;
};

export type CandidateRunOptions = {
  readonly signal?: AbortSignal;
  readonly versions?: BuildManifestVersions;
  readonly runnerOptions?: ScenarioRunnerOptions;
};

export type StartCandidateRunResult =
  | {
      readonly status: 'done';
      readonly runId: Id;
      readonly saveResult: SaveRunResult;
      readonly runResult: ScenarioRunResult;
      readonly value: { readonly kind: 'run'; readonly runId: Id };
      readonly superseded?: boolean;
    }
  | { readonly status: 'cancelled' }
  | InvalidResult
  | MissingResult
  | FailedResult;

export type CandidateControllerOptions = {
  readonly mintId: () => Id;
};

// ============================================================================
// CandidateController
// ============================================================================

export class CandidateController {
  // candidateId is an ephemeral controller handle, not a stored record.
  private readonly mintId: () => Id;
  private readonly candidates = new Map<Id, Candidate>();

  constructor(options: CandidateControllerOptions) {
    if (!options || typeof options.mintId !== 'function') {
      throw new Error('CandidateControllerOptions.mintId is required');
    }
    this.mintId = options.mintId;
  }

  /**
   * Prepares an isolated merge candidate from common DAG ancestry.
   */
  async prepare(
    ctx: CandidateContext,
    params: PrepareCandidateParams,
  ): Promise<PrepareCandidateResult> {
    const repo = 'repo' in ctx ? ctx.repo : ctx;

    const project = await repo.loadProject(params.projectId);
    if (!project) {
      return { status: 'missing', ids: [params.projectId] };
    }

    // Source is not main
    if (params.sourceBranchId === project.mainBranchId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Source branch cannot be main branch',
            ['sourceBranchId'],
            params.sourceBranchId,
          ),
        ],
      };
    }

    const sourceBranch = await repo.loadBranch(params.projectId, params.sourceBranchId);
    if (!sourceBranch) {
      return { status: 'missing', ids: [params.sourceBranchId] };
    }

    // Narrowest reading of closed branch semantics; candidate preparation requires an active open branch.
    if (sourceBranch.state === 'closed') {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Source branch is closed; cannot prepare candidate from closed branch',
            ['sourceBranchId'],
            params.sourceBranchId,
          ),
        ],
      };
    }

    const mainBranch = await repo.loadBranch(params.projectId, project.mainBranchId);
    if (!mainBranch) {
      return { status: 'missing', ids: [project.mainBranchId] };
    }

    // Source and main revisions match (stale)
    if (sourceBranch.workingRevision !== params.sourceRevision) {
      return {
        status: 'stale',
        scope: 'branch',
        expected: params.sourceRevision,
        actual: sourceBranch.workingRevision,
      };
    }

    if (mainBranch.workingRevision !== params.mainRevision) {
      return {
        status: 'stale',
        scope: 'branch',
        expected: params.mainRevision,
        actual: mainBranch.workingRevision,
      };
    }

    // Heads match (failed-conflict HEAD_MOVED)
    if (sourceBranch.headCommitId !== params.sourceHeadId) {
      return {
        status: 'failed',
        code: 'conflict',
        issues: [
          createIssue(
            'structural-rule',
            'HEAD_MOVED: Source branch head does not match sourceHeadId',
            ['sourceHeadId'],
            params.sourceHeadId,
          ),
        ],
      };
    }

    if (mainBranch.headCommitId !== params.mainHeadId) {
      return {
        status: 'failed',
        code: 'conflict',
        issues: [
          createIssue(
            'structural-rule',
            'HEAD_MOVED: Main branch head does not match mainHeadId',
            ['mainHeadId'],
            params.mainHeadId,
          ),
        ],
      };
    }

    // Source has a committed head (unborn source -> invalid)
    if (sourceBranch.headCommitId === null) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Source branch has no committed head; cannot prepare candidate from unborn branch',
            ['sourceBranchId'],
            sourceBranch.id,
          ),
        ],
      };
    }

    // Load source head commit
    const sourceHeadCommit = await repo.loadCommit(params.projectId, sourceBranch.headCommitId);
    if (!sourceHeadCommit) {
      return { status: 'missing', ids: [sourceBranch.headCommitId] };
    }

    // Source working snapshot == head snapshot
    if (sourceBranch.workingSnapshotId !== sourceHeadCommit.snapshotId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Source branch has uncommitted changes (working snapshot differs from head commit snapshot)',
            ['sourceBranchId'],
            sourceBranch.id,
          ),
        ],
      };
    }

    // Main working snapshot == main head snapshot, or creation snapshot while unborn
    let oursSnapshotId: string;
    if (mainBranch.headCommitId === null) {
      oursSnapshotId = project.initialSnapshotId;
      if (mainBranch.workingSnapshotId !== project.initialSnapshotId) {
        return {
          status: 'invalid',
          issues: [
            createIssue(
              'structural-rule',
              'Main branch has uncommitted changes (working snapshot differs from creation snapshot while unborn)',
              ['mainBranchId'],
              mainBranch.id,
            ),
          ],
        };
      }
    } else {
      const mainHeadCommit = await repo.loadCommit(params.projectId, mainBranch.headCommitId);
      if (!mainHeadCommit) {
        return { status: 'missing', ids: [mainBranch.headCommitId] };
      }
      oursSnapshotId = mainHeadCommit.snapshotId;
      if (mainBranch.workingSnapshotId !== mainHeadCommit.snapshotId) {
        return {
          status: 'invalid',
          issues: [
            createIssue(
              'structural-rule',
              'Main branch has uncommitted changes (working snapshot differs from head commit snapshot)',
              ['mainBranchId'],
              mainBranch.id,
            ),
          ],
        };
      }
    }

    const theirsSnapshotId = sourceHeadCommit.snapshotId;

    // Base via findMergeBase over repository commits (creation snapshot when unborn; never invent ancestry)
    const baseResult: MergeBaseResult = await findMergeBase(
      (commitId) => repo.loadCommit(params.projectId, commitId),
      mainBranch.headCommitId,
      sourceBranch.headCommitId,
      project.initialSnapshotId,
    );

    if (baseResult.status === 'ambiguous-merge-base') {
      return {
        status: 'failed',
        code: 'conflict',
        issues: [
          createIssue(
            'structural-rule',
            `Ambiguous merge base between commits: ${baseResult.commitIds.join(', ')}`,
            ['mergeBase'],
          ),
        ],
      };
    }

    if (baseResult.status === 'missing') {
      return {
        status: 'missing',
        ids: baseResult.commitIds ?? [],
      };
    }

    const mergeBaseSnapshotId = baseResult.snapshotId;
    const mergeBaseCommitId = baseResult.commitId;

    // Load base/ours(=main head)/theirs(=source head) snapshots
    const [baseSnapshot, oursSnapshot, theirsSnapshot] = await Promise.all([
      repo.loadSnapshot(params.projectId, mergeBaseSnapshotId),
      repo.loadSnapshot(params.projectId, oursSnapshotId),
      repo.loadSnapshot(params.projectId, theirsSnapshotId),
    ]);

    const missingSnapshotIds: string[] = [];
    if (!baseSnapshot) missingSnapshotIds.push(mergeBaseSnapshotId);
    if (!oursSnapshot) missingSnapshotIds.push(oursSnapshotId);
    if (!theirsSnapshot) missingSnapshotIds.push(theirsSnapshotId);
    if (missingSnapshotIds.length > 0) {
      return { status: 'missing', ids: missingSnapshotIds };
    }

    // mergeDocuments
    const mergeState = await mergeDocuments(
      baseSnapshot!.document,
      oursSnapshot!.document,
      theirsSnapshot!.document,
    );

    // Compute candidate snapshot ID (content hash of merged document)
    const snapshotId = await computeSnapshotId(mergeState.document);

    // candidateId is an ephemeral controller handle, not a stored record.
    const candidateId = this.mintId();

    const candidate: Candidate = deepFreeze({
      candidateId,
      projectId: params.projectId,
      sourceBranchId: params.sourceBranchId,
      mainBranchId: project.mainBranchId,
      expectedSourceRevision: params.sourceRevision,
      expectedSourceHeadId: params.sourceHeadId,
      expectedMainRevision: params.mainRevision,
      expectedMainHeadId: params.mainHeadId,
      mergeBase: {
        commitId: mergeBaseCommitId,
        snapshotId: mergeBaseSnapshotId,
      },
      snapshotId,
      mergeState,
      superseded: false,
    });

    this.candidates.set(candidateId, candidate);

    return {
      status: 'done',
      value: {
        kind: 'candidate',
        candidateId,
        snapshotId,
        conflictIds: mergeState.conflicts.map((c) => c.id),
      },
    };
  }

  /**
   * Resolves a conflict on a candidate, yielding a new candidate while superseding the old one.
   */
  async resolveConflict(
    _ctx: CandidateContext,
    params: ResolveConflictParams,
  ): Promise<ResolveConflictResult> {
    const old = this.candidates.get(params.candidateId);
    if (!old) {
      return { status: 'missing', ids: [params.candidateId] };
    }

    if (old.superseded) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${params.candidateId}' is superseded`,
            ['candidateId'],
            params.candidateId,
          ),
        ],
      };
    }

    const conflictExists = old.mergeState.conflicts.some((c) => c.id === params.conflictId);
    if (!conflictExists) {
      return { status: 'missing', ids: [params.conflictId] };
    }

    let newMergeState: MergeResult;
    try {
      newMergeState = await resolveConflictDomain(
        old.mergeState,
        params.conflictId,
        params.resolution,
      );
    } catch (err) {
      if (err instanceof ConflictResolutionError) {
        if (err.code === 'unknown-conflict') {
          return { status: 'missing', ids: [params.conflictId] };
        }
        return {
          status: 'invalid',
          issues: [
            createIssue(
              'structural-rule',
              err.message,
              ['conflictId'],
              params.conflictId,
            ),
          ],
        };
      }
      throw err;
    }

    const newSnapshotId = await computeSnapshotId(newMergeState.document);

    // candidateId is an ephemeral controller handle, not a stored record.
    const newCandidateId = this.mintId();

    // The old one becomes superseded
    this.candidates.set(
      params.candidateId,
      deepFreeze({
        ...old,
        superseded: true,
      }),
    );

    const newCandidate: Candidate = deepFreeze({
      ...old,
      candidateId: newCandidateId,
      snapshotId: newSnapshotId,
      mergeState: newMergeState,
      superseded: false,
    });

    this.candidates.set(newCandidateId, newCandidate);

    return {
      status: 'done',
      value: {
        kind: 'candidate',
        candidateId: newCandidateId,
        snapshotId: newSnapshotId,
        conflictIds: newMergeState.conflicts.map((c) => c.id),
      },
    };
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
    const cand = this.candidates.get(candidateId);
    if (!cand) {
      return { status: 'missing', ids: [candidateId], eligible: false };
    }

    if (cand.superseded) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${candidateId}' is superseded`,
            ['candidateId'],
            candidateId,
          ),
        ],
        eligible: false,
      };
    }

    // Readiness requires zero conflicts and no validation issues
    if (cand.mergeState.conflicts.length > 0) {
      return {
        status: 'failed',
        code: 'conflict',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${candidateId}' has ${cand.mergeState.conflicts.length} unresolved conflicts`,
            ['conflicts'],
          ),
        ],
        eligible: false,
      };
    }

    if (cand.mergeState.issues.length > 0) {
      return {
        status: 'invalid',
        issues: cand.mergeState.issues,
        eligible: false,
      };
    }

    const doc = cand.mergeState.document;
    const versions = options?.versions ?? DEFAULT_BUILD_VERSIONS;
    const candidateScenarios: CandidateScenario[] = [];

    for (const scenario of doc.scenarios) {
      const manifestRes = await buildManifest(doc, scenario.id, versions);
      if (manifestRes.status !== 'ok') {
        const issues = manifestFailureIssues(scenario.id, manifestRes);
        return {
          status: 'invalid',
          issues,
          eligible: false,
        };
      }

      candidateScenarios.push({
        scenarioId: scenario.id,
        fingerprint: manifestRes.fingerprint,
        scope: manifestRes.manifest.scope,
      });
    }

    const repo = 'repo' in ctx ? ctx.repo : ctx;
    const runs = await repo.listRuns(cand.projectId);
    const evalResult = evaluateCandidate(candidateScenarios, runs);

    return {
      status: 'done',
      eligible: evalResult.eligible,
      evaluation: evalResult,
    };
  }

  /**
   * Executes a candidate run and persists the outcome atomically without altering candidate or branches.
   */
  async startCandidateRun(
    ctx: CandidateContext,
    params: StartCandidateRunParams,
    options?: CandidateRunOptions,
  ): Promise<StartCandidateRunResult> {
    const cand = this.candidates.get(params.candidateId);
    if (!cand) {
      return { status: 'missing', ids: [params.candidateId] };
    }

    if (cand.superseded) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${params.candidateId}' is superseded`,
            ['candidateId'],
            params.candidateId,
          ),
        ],
      };
    }

    if (cand.mergeState.conflicts.length > 0) {
      return {
        status: 'failed',
        code: 'conflict',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${params.candidateId}' has ${cand.mergeState.conflicts.length} unresolved conflicts`,
            ['conflicts'],
          ),
        ],
      };
    }

    if (cand.mergeState.issues.length > 0) {
      return {
        status: 'invalid',
        issues: cand.mergeState.issues,
      };
    }

    const scenario = cand.mergeState.document.scenarios.find((s) => s.id === params.scenarioId);
    if (!scenario) {
      return { status: 'missing', ids: [params.scenarioId] };
    }

    const versions = options?.versions ?? DEFAULT_BUILD_VERSIONS;
    const signal = options?.signal ?? new AbortController().signal;

    // Candidate runs happen only while publishing: load the compiler and runner on demand
    // so they stay out of the app's initial bundle.
    const [{ prepareScenario }, { runScenario }] = await Promise.all([
      import('../../domain/studio/runner/compile'),
      import('../../domain/studio/runner/scenario-runner'),
    ]);
    const prepRes = await prepareScenario(
      { id: cand.snapshotId, document: cand.mergeState.document },
      params.scenarioId,
      signal,
      versions,
    );

    if (prepRes.status === 'cancelled') {
      return { status: 'cancelled' };
    }

    if (prepRes.status === 'invalid') {
      return {
        status: 'invalid',
        issues: prepRes.issues as readonly Issue[],
      };
    }

    if (prepRes.status !== 'ready') {
      throw new Error(`Unhandled prepareScenario status: ${(prepRes as any).status}`);
    }

    const token = mintRunStartToken({
      projectId: cand.projectId,
      runId: params.runId,
      snapshotId: cand.snapshotId,
      manifest: prepRes.manifest,
      fingerprint: prepRes.fingerprint,
      document: cand.mergeState.document, // pass document so saveRun can insert snapshot row!
    });

    const runResult = await runScenario(
      cand.mergeState.document,
      params.scenarioId,
      params.runId,
      options?.runnerOptions,
    );

    // Recheck if candidate was superseded after the run finished and before saveRun.
    // If superseded, we still save the run (saved outcomes are evidence for that snapshot),
    // but return the result with a superseded: true flag.
    const currentCand = this.candidates.get(params.candidateId);
    const wasSuperseded = !currentCand || currentCand.superseded;

    const repo = 'repo' in ctx ? ctx.repo : ctx;
    const terminalResult = {
      ...runResult,
      runId: params.runId,
      fingerprint: prepRes.fingerprint,
      snapshotId: cand.snapshotId,
    };

    const saveRes = await repo.saveRun(
      token,
      terminalResult,
      runResult.events,
      {
        projectId: cand.projectId,
        document: cand.mergeState.document,
      },
    );

    if (saveRes.status !== 'applied') {
      return saveRes;
    }

    return {
      status: 'done',
      runId: params.runId,
      saveResult: saveRes,
      runResult,
      value: {
        kind: 'run',
        runId: params.runId,
      },
      ...(wasSuperseded ? { superseded: true } : {}),
    };
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
    if (!command || typeof command !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('wrong-type', 'command must be an object', [])],
      };
    }

    // Envelope field validation. No fallbacks: every field must be present and valid.
    const opIdIssue = validateUuid(command.operationId, ['operationId'], 'operationId');
    if (opIdIssue) {
      return { status: 'invalid', issues: [opIdIssue] };
    }

    const projectIdIssue = validateUuid(command.projectId, ['projectId'], 'projectId');
    if (projectIdIssue) {
      return { status: 'invalid', issues: [projectIdIssue] };
    }

    const branchIdIssue = validateUuid(command.branchId, ['branchId'], 'branchId');
    if (branchIdIssue) {
      return { status: 'invalid', issues: [branchIdIssue] };
    }

    const workingRevIssue = validateRevision(
      command.expectedWorkingRevision,
      ['expectedWorkingRevision'],
      'expectedWorkingRevision',
    );
    if (workingRevIssue) {
      return { status: 'invalid', issues: [workingRevIssue] };
    }

    const actorIssues = validateActor(command.actor);
    if (actorIssues) {
      return { status: 'invalid', issues: actorIssues };
    }

    if (!command.payload || typeof command.payload !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'payload is required', ['payload'])],
      };
    }

    const payload = command.payload;

    const candidateIdIssue = validateUuid(
      payload.candidateId,
      ['payload', 'candidateId'],
      'candidateId',
    );
    if (candidateIdIssue) {
      return { status: 'invalid', issues: [candidateIdIssue] };
    }

    const publicationIdIssue = validateUuid(
      payload.publicationId,
      ['payload', 'publicationId'],
      'publicationId',
    );
    if (publicationIdIssue) {
      return { status: 'invalid', issues: [publicationIdIssue] };
    }

    const mergeCommitIdIssue = validateUuid(
      payload.mergeCommitId,
      ['payload', 'mergeCommitId'],
      'mergeCommitId',
    );
    if (mergeCommitIdIssue) {
      return { status: 'invalid', issues: [mergeCommitIdIssue] };
    }

    if (!payload.metadata || typeof payload.metadata !== 'object') {
      return {
        status: 'invalid',
        issues: [
          createIssue('missing-property', 'payload.metadata is required', ['payload', 'metadata']),
        ],
      };
    }

    if (!Array.isArray(payload.evidence)) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'missing-property',
            'payload.evidence is required and must be an array',
            ['payload', 'evidence'],
          ),
        ],
      };
    }

    // keepSourceOpen is the only defaulted field (omitted -> false).
    let keepSourceOpen: boolean;
    if (payload.keepSourceOpen === undefined) {
      keepSourceOpen = false;
    } else if (typeof payload.keepSourceOpen !== 'boolean') {
      return {
        status: 'invalid',
        issues: [
          createIssue('wrong-type', 'payload.keepSourceOpen must be a boolean', [
            'payload',
            'keepSourceOpen',
          ]),
        ],
      };
    } else {
      keepSourceOpen = payload.keepSourceOpen;
    }

    const expectedProjectRevIssue = validateRevision(
      payload.expectedProjectRevision,
      ['payload', 'expectedProjectRevision'],
      'expectedProjectRevision',
    );
    if (expectedProjectRevIssue) {
      return { status: 'invalid', issues: [expectedProjectRevIssue] };
    }

    const candidateId = payload.candidateId;
    const cand = this.candidates.get(candidateId);
    if (!cand) {
      return { status: 'missing', ids: [candidateId] };
    }

    if (cand.superseded) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${candidateId}' is superseded`,
            ['candidateId'],
            candidateId,
          ),
        ],
      };
    }

    if (cand.mergeState.conflicts.length > 0) {
      return {
        status: 'failed',
        code: 'conflict',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${candidateId}' has ${cand.mergeState.conflicts.length} unresolved conflicts`,
            ['conflicts'],
          ),
        ],
      };
    }

    if (cand.mergeState.issues.length > 0) {
      return {
        status: 'invalid',
        issues: cand.mergeState.issues,
      };
    }

    // Context mismatch is rejected outright; it is never a fallback to the candidate's values.
    if (command.projectId !== cand.projectId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Command projectId '${command.projectId}' does not match candidate projectId '${cand.projectId}'`,
            ['projectId'],
            command.projectId,
          ),
        ],
      };
    }

    if (command.branchId !== cand.sourceBranchId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Command branchId '${command.branchId}' does not match candidate sourceBranchId '${cand.sourceBranchId}'`,
            ['branchId'],
            command.branchId,
          ),
        ],
      };
    }

    if (command.expectedWorkingRevision !== cand.expectedSourceRevision) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Command expectedWorkingRevision '${command.expectedWorkingRevision}' does not match candidate expectedSourceRevision '${cand.expectedSourceRevision}'`,
            ['expectedWorkingRevision'],
          ),
        ],
      };
    }

    const ticket = mintPublishTicket({
      candidateId: cand.candidateId,
      projectId: cand.projectId,
      sourceBranchId: cand.sourceBranchId,
      mainBranchId: cand.mainBranchId,
      expectedSourceRevision: cand.expectedSourceRevision,
      expectedSourceHeadId: cand.expectedSourceHeadId,
      expectedMainRevision: cand.expectedMainRevision,
      expectedMainHeadId: cand.expectedMainHeadId,
      snapshotId: cand.snapshotId,
      document: cand.mergeState.document,
      operationId: command.operationId,
    });

    const fullCommand: HistoryPublishCommand = {
      commandId: 'history.publish',
      operationId: command.operationId,
      projectId: command.projectId,
      branchId: command.branchId,
      expectedWorkingRevision: command.expectedWorkingRevision,
      actor: command.actor,
      payload: {
        candidateId: payload.candidateId,
        publicationId: payload.publicationId,
        mergeCommitId: payload.mergeCommitId,
        metadata: payload.metadata,
        evidence: payload.evidence,
        keepSourceOpen,
        expectedProjectRevision: payload.expectedProjectRevision,
      },
    };

    const repo = 'repo' in ctx ? ctx.repo : ctx;
    return repo.publish(ticket, fullCommand);
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
