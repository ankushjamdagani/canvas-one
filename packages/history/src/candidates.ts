import { findMergeBase, type MergeBaseResult, type CommitLike } from './merge-base.js';
import { createIssue, type ValidationIssue } from '@canvas-one/whiteboard';

export type CandidateMergeBase = { readonly commitId: string | null; readonly snapshotId: string };
export type CandidateState<Merge> = {
  readonly candidateId: string; readonly projectId: string;
  readonly sourceBranchId: string; readonly mainBranchId: string;
  readonly expectedSourceRevision: number; readonly expectedSourceHeadId: string | null;
  readonly expectedMainRevision: number; readonly expectedMainHeadId: string | null;
  readonly mergeBase: CandidateMergeBase; readonly snapshotId: string;
  readonly mergeState: Merge; readonly superseded: boolean;
};
export type CandidateValue = {
  readonly kind: 'candidate'; readonly candidateId: string;
  readonly snapshotId: string; readonly conflictIds: readonly string[];
};
export type CandidateLifecycleIssue = ValidationIssue<'structural-rule'>;
export type CandidateResolutionResult =
  | { readonly status: 'done'; readonly value: CandidateValue }
  | { readonly status: 'missing'; readonly ids: readonly string[] }
  | { readonly status: 'failed'; readonly code: 'ineligible'; readonly issues: readonly CandidateLifecycleIssue[] }
  | { readonly status: 'invalid'; readonly issues: readonly CandidateLifecycleIssue[] };
export type CandidateLifecyclePorts<Merge, Resolution> = {
  readonly mintId: () => string;
  readonly conflictIds: (merge: Merge) => readonly string[];
  readonly resolve: (merge: Merge, conflictId: string, resolution: Resolution) => Promise<Merge>;
  readonly snapshotId: (merge: Merge) => Promise<string>;
  readonly freeze: <Value>(value: Value) => Value;
  readonly resolutionError: (error: unknown) => { readonly code: string; readonly message: string } | null;
};


export type PrepareCandidateParams = {
  readonly projectId: string; readonly sourceBranchId: string;
  readonly sourceRevision: number; readonly sourceHeadId: string | null;
  readonly mainRevision: number; readonly mainHeadId: string | null;
};
export type PrepareCandidateResult =
  | { readonly status: 'done'; readonly value: CandidateValue }
  | { readonly status: 'invalid'; readonly issues: readonly CandidateLifecycleIssue[] }
  | { readonly status: 'missing'; readonly ids: readonly string[] }
  | { readonly status: 'stale'; readonly scope: 'branch'; readonly expected: number; readonly actual: number }
  | { readonly status: 'failed'; readonly code: 'conflict'; readonly issues: readonly CandidateLifecycleIssue[] };
export type CandidateVersionStore<Document> = {
  loadProject(projectId: string): Promise<{ readonly mainBranchId: string; readonly initialSnapshotId: string } | null>;
  loadBranch(projectId: string, branchId: string): Promise<{
    readonly id: string; readonly state: string; readonly workingRevision: number;
    readonly headCommitId: string | null; readonly workingSnapshotId: string;
  } | null>;
  loadCommit(projectId: string, commitId: string): Promise<CommitLike | null>;
  loadSnapshot(projectId: string, snapshotId: string): Promise<{ readonly document: Document } | null>;
};
export type CandidatePreparationPorts<Merge, Document> = {
  readonly store: CandidateVersionStore<Document>;
  readonly merge: (base: Document, ours: Document, theirs: Document) => Promise<Merge>;
};

/** In-memory candidate authority. Persistence and domain policies are supplied by its host. */
export class CandidateService<Merge, Resolution> {
  private readonly candidates = new Map<string, CandidateState<Merge>>();
  constructor(private readonly ports: CandidateLifecyclePorts<Merge, Resolution>) {}

  async prepare<Document>(preparation: CandidatePreparationPorts<Merge, Document>, params: PrepareCandidateParams): Promise<PrepareCandidateResult> {
    const repo = preparation.store;

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
    const mergeState = await preparation.merge(
      baseSnapshot!.document,
      oursSnapshot!.document,
      theirsSnapshot!.document,
    );

    // Compute candidate snapshot ID (content hash of merged document)
    const snapshotId = await this.ports.snapshotId(mergeState);

    // candidateId is an ephemeral controller handle, not a stored record.
    const candidateId = this.ports.mintId();

    const candidate: CandidateState<Merge> = this.ports.freeze({
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

    this.register(candidate);

    return {
      status: 'done',
      value: {
        kind: 'candidate',
        candidateId,
        snapshotId,
        conflictIds: this.ports.conflictIds(mergeState),
      },
    };
  }


  register(candidate: CandidateState<Merge>): void {
    if (this.candidates.has(candidate.candidateId)) throw new Error(`Candidate '${candidate.candidateId}' already exists`);
    this.candidates.set(candidate.candidateId, this.ports.freeze(candidate));
  }

  get(candidateId: string): CandidateState<Merge> | null { return this.candidates.get(candidateId) ?? null; }

  async resolveConflict(params: { readonly candidateId: string; readonly conflictId: string; readonly resolution: Resolution }): Promise<CandidateResolutionResult> {
    const old = this.get(params.candidateId);
    if (!old) return { status: 'missing', ids: [params.candidateId] };
    if (old.superseded) return { status: 'failed', code: 'ineligible', issues: [createIssue('structural-rule', `Candidate '${params.candidateId}' is superseded`, ['candidateId'], params.candidateId)] };
    if (!this.ports.conflictIds(old.mergeState).includes(params.conflictId)) return { status: 'missing', ids: [params.conflictId] };
    let merge: Merge;
    try { merge = await this.ports.resolve(old.mergeState, params.conflictId, params.resolution); }
    catch (error) {
      const failure = this.ports.resolutionError(error);
      if (!failure) throw error;
      if (failure.code === 'unknown-conflict') return { status: 'missing', ids: [params.conflictId] };
      return { status: 'invalid', issues: [createIssue('structural-rule', failure.message, ['conflictId'], params.conflictId)] };
    }
    const snapshotId = await this.ports.snapshotId(merge);
    const candidateId = this.ports.mintId();
    this.candidates.set(old.candidateId, this.ports.freeze({ ...old, superseded: true }));
    const candidate = this.ports.freeze({ ...old, candidateId, snapshotId, mergeState: merge, superseded: false });
    this.candidates.set(candidateId, candidate);
    return { status: 'done', value: { kind: 'candidate', candidateId, snapshotId, conflictIds: this.ports.conflictIds(merge) } };
  }
}
