import type { Document, Id } from '../studio/model.js';
import type { RecordChange, EditableRecord, RecordKind } from '../studio/records.js';
import { canonicalJson } from '../studio/canonical.js';
import type { Issue } from '../studio/validate.js';
import type { ProjectExposure } from '../studio/exposure.js';
import type { CaptureSelection } from '../parts/types.js';
import type { BranchRecord } from '@canvas-one/history';
export type Actor = import('@canvas-one/whiteboard').Actor<'local-human'>;
export type { RecordChange, BranchRecord };
export type ExpectedHead = Id | null;

export type CommandValue =
  | { readonly kind: 'none' }
  | { readonly kind: 'project'; readonly projectId: Id; readonly branchId: Id }
  | { readonly kind: 'branch'; readonly branchId: Id }
  | {
      readonly kind: 'artifact';
      readonly artifactType: 'checkpoint' | 'commit' | 'publication' | 'part';
      readonly id: Id;
      readonly revision: number | null;
    }
  | { readonly kind: 'run'; readonly runId: Id }
  | {
      readonly kind: 'candidate';
      readonly candidateId: Id;
      readonly snapshotId: string;
      readonly conflictIds: readonly Id[];
    }
  | { readonly kind: 'draft'; readonly draftId: Id }
  | { readonly kind: 'download'; readonly downloadId: Id };

export type ProposalAttribution = import('@canvas-one/agents').ProposalAttribution;
export type TaskAttribution = import('@canvas-one/agents').AttemptBinding;
export type LiveTaskTarget = { readonly recordKind: RecordKind; readonly id: string; readonly before: EditableRecord | null };
export type LiveTaskAction = {
  readonly operationId: Id; readonly binding: TaskAttribution; readonly changes: readonly RecordChange[];
  readonly expectedRecords: readonly LiveTaskTarget[]; readonly label: string;
};
/** Exact target comparisons permit unrelated edits but never overwrite an edited target. */
export function liveTaskTargetsMatch(document: Document, changes: readonly RecordChange[], expected: readonly LiveTaskTarget[]): boolean {
  if (!Array.isArray(changes) || !Array.isArray(expected) || changes.length === 0 || changes.length > 1000 || expected.length !== changes.length) return false;
  const tables = { element: document.elements, connection: document.connections, relation: document.relations, schema: document.schemas, fixture: document.fixtures, refinement: document.refinements, scenario: document.scenarios, view: document.views };
  const seen = new Set<string>();
  for (const change of changes) {
    if (!change || typeof change !== 'object' || !['insert', 'replace', 'remove'].includes(change.kind)) return false;
    const kind = change.kind === 'remove' ? change.recordKind : change.value?.recordKind;
    const id = change.kind === 'remove' ? change.id : change.value?.record?.id;
    if (!kind || !Object.hasOwn(tables, kind) || typeof id !== 'string') return false;
    const key = JSON.stringify([kind, id]);
    if (seen.has(key)) return false;
    seen.add(key);
    const target = expected.find(value => value && value.recordKind === kind && value.id === id);
    if (!target || (change.kind === 'insert' ? target.before !== null : !target.before || target.before.recordKind !== kind || target.before.record?.id !== id)) return false;
    const actual = tables[kind as RecordKind].find((value: { readonly id: string }) => value.id === id);
    if (target.before === null ? actual !== undefined : !actual) return false;
    if (target.before !== null) {
      const left = canonicalJson(actual), right = canonicalJson(target.before.record);
      if (!left.ok || !right.ok || left.text !== right.text) return false;
    }
  }
  return true;
}
export type AppliedResult = {
  readonly status: 'applied';
  readonly operationId: Id;
  readonly projectRevision: number;
  readonly branchRevision: number | null;
  readonly changedIds: readonly Id[];
  readonly undo: { readonly entryId: Id; readonly label: string } | null;
  readonly value: CommandValue;
  readonly proposal?: ProposalAttribution;
  readonly task?: TaskAttribution;
};

export type InvalidResult = {
  readonly status: 'invalid';
  readonly issues: readonly Issue[];
};

export type StaleResult = {
  readonly status: 'stale';
  readonly scope: 'project' | 'branch' | 'preferences';
  readonly expected: unknown;
  readonly actual: unknown;
};

export type MissingResult = {
  readonly status: 'missing';
  readonly ids: readonly Id[];
};

export type FailedCode = 'quota' | 'unavailable' | 'referenced-artifact' | 'operation-id-reused' | 'limit' | 'unsupported-version'
  | 'ineligible'
  | 'conflict'
  | 'duplicate-version';

export type FailedResult = { readonly status: 'failed'; readonly code: FailedCode; readonly issues: readonly Issue[] };

export type UnsupportedResult = {
  readonly status: 'unsupported';
  readonly message: string;
};

export type AuthoredResult =
  | AppliedResult
  | InvalidResult
  | StaleResult
  | MissingResult
  | FailedResult;


export type ProjectCreateCommand = {
  readonly commandId: 'project.create';
  readonly operationId: Id;
  readonly actor: Actor;
  readonly payload: {
    readonly newProjectId: Id;
    readonly title: string;
    readonly initialDocument: Document;
    readonly mainBranchId: Id;
    readonly draftBranchId: Id;
  };
};

export type ProjectRenameCommand = {
  readonly commandId: 'project.rename';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly expectedProjectRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly title: string;
    readonly expectedProjectRevision?: number;
  };
};

export type ProjectUpdateDetailsCommand = {
  readonly commandId: 'project.update-details';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly expectedProjectRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly description: string;
    readonly team: string;
    /** when present, replaces the project's exposed connection types. */
    readonly exposures?: readonly ProjectExposure[];
  };
};

export type BranchCreateCommand = {
  readonly commandId: 'branch.create';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id; // source branch
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly newBranchId: Id;
    readonly label: string;
    readonly source: 'working' | 'head';
    readonly expectedHeadId: ExpectedHead;
  };
};

export type BranchReopenCommand = {
  readonly commandId: 'branch.reopen';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly expectedHeadId: ExpectedHead;
  };
};

export type ModelApplyRecordsCommand = {
  readonly commandId: 'model.apply-records';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly changes: readonly RecordChange[];
    readonly proposal?: ProposalAttribution;
    readonly taskAuthority?: TaskAttribution;
    readonly expectedRecords?: readonly LiveTaskTarget[];
  };
};

export type PartCaptureCommand = {
  readonly commandId: "part.capture";
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly operationId: Id;
  readonly actor: Actor;
  readonly payload: CaptureSelection & {
    readonly partId: Id;
    readonly revision: number;
    readonly expectedLatestRevision: number | null;
    readonly viewId: Id;
    readonly label: string;
    readonly description: string;
    readonly dependencyPreviewId: Id;
  };
};

export type PartImportCommand = {
  readonly commandId: "part.import";
  readonly projectId: Id;
  readonly operationId: Id;
  readonly actor: Actor;
  readonly expectedProjectRevision: number;
  readonly payload: { readonly fileToken: unknown; readonly partId: Id };
};
export type SessionCommand = ProjectCreateCommand | ProjectRenameCommand | ProjectUpdateDetailsCommand |
 BranchCreateCommand | BranchReopenCommand | ModelApplyRecordsCommand | PartCaptureCommand | PartImportCommand;
export type SnapshotRecord = { readonly id: string; readonly document: Document };
/** Only the reads and authored commands required by this editing session. */
export interface SessionRepository {
 replayAgentTaskAction?(command: ModelApplyRecordsCommand): Promise<AuthoredResult | null>;
 execute(command: SessionCommand): Promise<AuthoredResult | UnsupportedResult>;
 loadProject(projectId: Id): Promise<{readonly id: Id; readonly revision: number; readonly mainBranchId: Id} | null>;
 loadBranch(projectId: Id, branchId: Id): Promise<BranchRecord | null>;
 loadSnapshot(projectId: Id, snapshotId: string): Promise<SnapshotRecord | null>;
 loadHistory(projectId: Id): Promise<{readonly branches: readonly BranchRecord[]}>;
}
