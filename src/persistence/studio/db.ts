/**
 * Dexie database definition for System Studio (RV-16a).
 *
 * Implements specs/revamp/contracts/storage.md §1 & §2:
 * - Database namespace: `system-studio-local-v1`, version 1.
 * - Tables, composite keys, and indexes matching storage.md §2 exactly:
 *   - projects: primary key `id`, indexes `updatedAt`
 *   - branches: primary key `[projectId+id]`, indexes `projectId`
 *   - snapshots: primary key `[projectId+id]`, indexes `projectId`
 *   - commits: primary key `[projectId+id]`, indexes `projectId`
 *   - publications: primary key `[projectId+id]`, indexes `projectId`, unique `[projectId+ordinal]`, unique `[projectId+versionKey]`
 *   - checkpoints: primary key `[projectId+id]`, indexes `projectId`
 *   - runs: primary key `[projectId+id]`, indexes `projectId`, `[projectId+fingerprint]`
 *   - traceChunks: primary key `[projectId+runId+index]`, indexes `[projectId+runId]`
 *   - operations: primary key `[projectId+id]`, indexes `projectId`
 *   - parts: primary key `[projectId+id+revision]`, indexes `projectId`, `[projectId+id]`
 *   - preferences: primary key `key`
 */

import Dexie, { type Table } from 'dexie';
import { DB_NAME, DB_VERSION } from './types';
export { DB_NAME, DB_VERSION };
import type {
  BranchRecord,
  CheckpointRecord,
  CommitRecord,
  OperationRecord,
  PartRecord,
  PreferenceRecord,
  ProjectRecord,
  PublicationRecord,
  RunRecord,
  SnapshotRecord,
  TraceChunkRecord,
} from './types';

export class StudioDatabase extends Dexie {
  projects!: Table<ProjectRecord, string>;
  branches!: Table<BranchRecord, [string, string]>;
  snapshots!: Table<SnapshotRecord, [string, string]>;
  commits!: Table<CommitRecord, [string, string]>;
  publications!: Table<PublicationRecord, [string, string]>;
  checkpoints!: Table<CheckpointRecord, [string, string]>;
  runs!: Table<RunRecord, [string, string]>;
  traceChunks!: Table<TraceChunkRecord, [string, string, number]>;
  operations!: Table<OperationRecord, [string, string]>;
  parts!: Table<PartRecord, [string, string, number]>;
  preferences!: Table<PreferenceRecord, string>;

  constructor(dbName = DB_NAME) {
    super(dbName);

    this.version(DB_VERSION).stores({
      projects: 'id, updatedAt',
      branches: '[projectId+id], projectId',
      snapshots: '[projectId+id], projectId',
      commits: '[projectId+id], projectId',
      publications:
        '[projectId+id], projectId, &[projectId+ordinal], &[projectId+versionKey]',
      checkpoints: '[projectId+id], projectId',
      runs: '[projectId+id], projectId, [projectId+fingerprint]',
      traceChunks: '[projectId+runId+index], [projectId+runId]',
      operations: '[projectId+id], projectId',
      parts: '[projectId+id+revision], projectId, [projectId+id]',
      preferences: 'key',
    });
  }
}

/**
 * Creates and returns a new StudioDatabase instance.
 * Defaults to the production database name 'system-studio-local-v1',
 * but accepts a custom database name for test isolation.
 */
export function createStudioDatabase(dbName = DB_NAME): StudioDatabase {
  return new StudioDatabase(dbName);
}
