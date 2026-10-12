/** Immutable history records. Semantic evidence and actor policy are supplied by consumers. */
export type SemanticVersion = { readonly major: number; readonly minor: number; readonly patch: number };
export type PublicationMetadata = {
  readonly version: SemanticVersion; readonly title: string; readonly rationale: string; readonly ticketUrl: string | null;
};
export type BranchRecord = {
  readonly projectId: string; readonly id: string; readonly label: string; readonly state: 'open' | 'closed';
  readonly headCommitId: string | null; readonly workingSnapshotId: string; readonly workingRevision: number; readonly createdAt: number;
};
export type CommitRecord<Actor = unknown, Evidence = unknown, Manifest = unknown> = {
  readonly projectId: string; readonly id: string; readonly snapshotId: string; readonly parentIds: readonly string[];
  readonly evidence: readonly Evidence[]; readonly evidenceManifest?: Manifest;
  readonly actor: Actor; readonly createdAt: number; readonly message: string;
};
export type CheckpointRecord<Actor = unknown> = {
  readonly projectId: string; readonly id: string; readonly snapshotId: string; readonly sourceBranchId: string;
  readonly label: string; readonly actor: Actor; readonly createdAt: number;
};
export type PublicationRecord<Actor = unknown> = {
  readonly projectId: string; readonly id: string; readonly commitId: string; readonly sourceBranchId: string;
  readonly previousMainHeadId: string | null; readonly ordinal: number; readonly actor: Actor; readonly createdAt: number;
  readonly metadata: PublicationMetadata; readonly versionKey: string;
};
