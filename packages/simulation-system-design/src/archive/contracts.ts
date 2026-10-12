import type { PortableRow, ConsistentArchiveReader, SnapshotRecord } from '@canvas-one/storage';
import type { Document, Id } from '@canvas-one/system-design/studio/model';
import type { FailedResult, InvalidResult, MissingResult, StaleResult } from '@canvas-one/system-design/session/contracts';
import type { BranchRecord, CommitRecord, PublicationRecord, CheckpointRecord } from '../history/contracts.js';
import type { RunRecord } from '../artifacts.js';

export const PORTABLE_FORMAT = 'system-studio' as const;
export const PORTABLE_VERSION = 9 as const;
export type PartRecord = {
  readonly projectId: Id; readonly id: Id; readonly revision: number; readonly label: string;
  readonly description: string; readonly content: unknown; readonly createdAt: number;
};
export type BundleBranchRecord = PortableRow<BranchRecord>;
export type BundleSnapshotRecord = PortableRow<SnapshotRecord<Document>>;
export type BundleCommitRecord = PortableRow<CommitRecord>;
export type BundlePublicationRecord = PortableRow<PublicationRecord>;
export type BundleCheckpointRecord = PortableRow<CheckpointRecord>;
export type BundleRunRecord = PortableRow<RunRecord>;
export type BundlePartRecord = PortableRow<PartRecord>;
/** Authored content/history/results only; excludes local namespaces, receipts, preferences and trace bytes. */
export type ProjectBundle = {
  readonly id: Id; readonly title: string; readonly createdAt: number; readonly updatedAt: number;
  readonly mainBranchId: Id; readonly initialSnapshotId: string;
  readonly branches: readonly BundleBranchRecord[]; readonly snapshots: readonly BundleSnapshotRecord[];
  readonly commits: readonly BundleCommitRecord[]; readonly publications: readonly BundlePublicationRecord[];
  readonly checkpoints: readonly BundleCheckpointRecord[]; readonly runs: readonly BundleRunRecord[];
  readonly parts: readonly BundlePartRecord[];
};
export type PortableFile = { readonly format: typeof PORTABLE_FORMAT; readonly version: typeof PORTABLE_VERSION; readonly project: ProjectBundle };
export type ArchiveLimits = {
  readonly maxExportEnvelopeBytes: number; readonly maxBranchesPerProject: number; readonly maxCommitsPerProject: number;
  readonly maxCheckpointsPerProject: number; readonly maxRunSummariesPerProject: number; readonly maxPartRevisionsPerProject: number;
};
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = Object.freeze({ maxExportEnvelopeBytes: 64 * 1024 * 1024,
  maxBranchesPerProject: 100, maxCommitsPerProject: 1000, maxCheckpointsPerProject: 100, maxRunSummariesPerProject: 200, maxPartRevisionsPerProject: 100 });
export type ExportProjectParams = { readonly projectId: Id; readonly expectedProjectRevision: number };
export type ExportProjectResult =
  | { readonly status: 'done'; readonly value: { readonly kind: 'download'; readonly downloadId: Id }; readonly bytes: Uint8Array; readonly sha256: string }
  | InvalidResult | StaleResult | MissingResult | FailedResult;
export type ArchiveReadSnapshot = {
  readonly project: Pick<ProjectBundle, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'mainBranchId' | 'initialSnapshotId'>;
  readonly branches: readonly BranchRecord[]; readonly snapshots: readonly SnapshotRecord<Document>[];
  readonly commits: readonly CommitRecord[]; readonly publications: readonly PublicationRecord[];
  readonly checkpoints: readonly CheckpointRecord[]; readonly runs: readonly RunRecord[]; readonly parts: readonly PartRecord[];
};
export type ArchiveReader = ConsistentArchiveReader<ExportProjectParams, ArchiveReadSnapshot, MissingResult | StaleResult>;
export type ArchiveExportOptions = {
  readonly reader: ArchiveReader; readonly mintId?: () => Id;
  readonly mapError: (error: unknown) => FailedResult;
  readonly limits?: ArchiveLimits;
  readonly missingMintIdMessage?: string;
};
