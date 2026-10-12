/**
 * Dexie database definition for System Studio.
 *
 * - Database namespace: `system-studio-local-v1`, version 1.
 * - Tables, composite keys, and indexes:
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

import { IndexedDbDatabase, type BoundTables } from '@canvas-one/storage-indexeddb';
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

type StudioRows = {
  projects: { row: ProjectRecord; key: string };
  branches: { row: BranchRecord; key: [string, string] };
  snapshots: { row: SnapshotRecord; key: [string, string] };
  commits: { row: CommitRecord; key: [string, string] };
  publications: { row: PublicationRecord; key: [string, string] };
  checkpoints: { row: CheckpointRecord; key: [string, string] };
  runs: { row: RunRecord; key: [string, string] };
  traceChunks: { row: TraceChunkRecord; key: [string, string, number] };
  operations: { row: OperationRecord; key: [string, string] };
  parts: { row: PartRecord; key: [string, string, number] };
  preferences: { row: PreferenceRecord; key: string };
};
export interface StudioDatabase extends BoundTables<StudioRows> {}
export class StudioDatabase extends IndexedDbDatabase<StudioRows> {

  constructor(dbName = DB_NAME) {
    super(dbName, DB_VERSION, {
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
