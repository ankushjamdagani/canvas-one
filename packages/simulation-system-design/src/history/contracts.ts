import type { Document, Id } from '@canvas-one/system-design/studio/model';
import type { SessionState } from '@canvas-one/system-design/session/types';
import type { Actor, AuthoredResult, UnsupportedResult, FailedResult, InvalidResult, MissingResult, StaleResult, AppliedResult } from '@canvas-one/system-design/session/contracts';
import type { EvidenceRef, EvidenceManifest } from '../runner/evidence.js';
import type { RunRecord } from '../artifacts.js';
import type { ConflictResolution } from '@canvas-one/system-design/versioning/resolve';
import type { MergeResult } from '@canvas-one/system-design/versioning/merge';
import type { CandidateState, CandidateValue, PrepareCandidateParams, HistoryAuthoredCommand, HistoryPublishCommand } from '@canvas-one/history';
import type { StartCandidateRunResult } from '../candidate-execution.js';
import type { EvaluateCandidateResult as GenericEvaluation, RunCandidate as GenericRunCandidate } from '@canvas-one/history';
import type { CheckResult, RunSummary } from '../runner/types.js';

export type { Actor, AuthoredResult, UnsupportedResult, FailedResult, InvalidResult, MissingResult, StaleResult, AppliedResult, PrepareCandidateParams };
export type { PublicationMetadata, BranchRecord } from '@canvas-one/history';
export type ExpectedHead = Id | null;
export type CommitRecord = import('@canvas-one/history').CommitRecord<Actor, EvidenceRef, EvidenceManifest>;
export type CheckpointRecord = import('@canvas-one/history').CheckpointRecord<Actor>;
export type PublicationRecord = import('@canvas-one/history').PublicationRecord<Actor>;
export type HistoryProject = { readonly id: Id; readonly mainBranchId: Id; readonly initialSnapshotId: string; readonly revision: number };
export type HistoryLoadResult = {
  readonly project: HistoryProject;
  readonly branches: readonly import('@canvas-one/history').BranchRecord[];
  readonly commits: readonly CommitRecord[];
  readonly checkpoints: readonly CheckpointRecord[];
  readonly publications: readonly PublicationRecord[];
  readonly branchHistories: readonly { readonly branchId: Id; readonly commits: readonly CommitRecord[] }[];
};

/** Only the session authority capabilities required by history/publication workflows. */
export interface HistorySession {
  getState(): Pick<SessionState, 'projectId' | 'branchId' | 'workingRevision' | 'document'>;
  readonly undoStack: readonly { readonly label: string }[];
  subscribe(listener: () => void): () => void;
  openProject(projectId: Id, branchId: Id): Promise<unknown>;
}

/** Storage implementation is supplied by the host. No database dependency is loaded. */
export interface HistoryRepository {
  execute(command: HistoryAuthoredCommand<Actor, EvidenceRef>): Promise<AuthoredResult | UnsupportedResult>;
  loadHistory(projectId: Id): Promise<HistoryLoadResult>;
  loadProject(projectId: Id): Promise<HistoryProject | null>;
  loadBranch(projectId: Id, branchId: Id): Promise<import('@canvas-one/history').BranchRecord | null>;
  loadCommit(projectId: Id, commitId: Id): Promise<CommitRecord | null>;
  loadSnapshot(projectId: Id, snapshotId: string): Promise<{ readonly document: Document } | null>;
  listRuns(projectId: Id): Promise<readonly RunRecord[]>;
  runsByFingerprint(projectId: Id, fingerprint: string): Promise<readonly RunRecord[]>;
  listPublications(projectId: Id): Promise<readonly PublicationRecord[]>;
  loadPublication(projectId: Id, publicationId: Id): Promise<PublicationRecord | null>;
}

export type Candidate = CandidateState<MergeResult>;
export type PrepareCandidateResult = { readonly status: 'done'; readonly value: CandidateValue } | InvalidResult | StaleResult | MissingResult | FailedResult;
export type ResolveConflictResult = { readonly status: 'done'; readonly value: CandidateValue } | InvalidResult | MissingResult | FailedResult;
export type RunCandidate = GenericRunCandidate<CheckResult, RunSummary>;
export type EvaluateCandidateResult = GenericEvaluation<RunCandidate>;
export type EvaluateCandidateOutput =
  | { readonly status: 'done'; readonly eligible: boolean; readonly evaluation: EvaluateCandidateResult }
  | ((InvalidResult | MissingResult | FailedResult) & { readonly eligible: false });
export type CandidateRunResult = StartCandidateRunResult<import('@canvas-one/system-design/session/contracts').FailedCode>;

/** Host binds the generic history candidate service and its domain/execution policies. */
export interface CandidateController {
  get(candidateId: Id): Candidate | null;
  prepare(context: unknown, params: PrepareCandidateParams): Promise<PrepareCandidateResult>;
  resolveConflict(context: unknown, params: { readonly candidateId: Id; readonly conflictId: Id; readonly resolution: ConflictResolution }): Promise<ResolveConflictResult>;
  evaluate(context: unknown, candidateId: Id): Promise<EvaluateCandidateOutput>;
  publish(context: unknown, command: HistoryPublishCommand<Actor, EvidenceRef>): Promise<AuthoredResult>;
}
