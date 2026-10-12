/** IndexedDB bindings for storage-owned count, byte and retention policies. */
import { ProjectAccountingService, collectProjectRows, type TransactionStores, type LimitCheckAdditions, type AccountedBytes } from '@canvas-one/storage';
import { canonicalJson } from '../../domain/studio/canonical';
import type { StudioDatabase } from './db';
import { createIssue } from '../../domain/studio/issue';
import { RepositoryError } from './errors';
import { computeProjectPinClosure, computeProjectPinClosureFromStores } from './pin-state';
import type {ProjectStorageRows} from './repository';
import { STORAGE_LIMITS, type FailedResult, type RunRecord } from './types';
export type { LimitCheckAdditions, AccountedBytes };

export function calculateRecordBytes(record: unknown): number {
  const result = canonicalJson(record);
  if (!result.ok) throw new RepositoryError({
    code: 'invalid', message: 'Failed to compute canonical JSON size for record', issues: result.issues,
  });
  return result.bytes;
}

function accounting(db: StudioDatabase, stores?: TransactionStores<ProjectStorageRows>): ProjectAccountingService<FailedResult> {
  const rows = (table: Exclude<keyof ProjectStorageRows, 'projects'>, projectId: string) => collectProjectRows<{readonly projectId: string}>(stores![table], projectId);
  return new ProjectAccountingService({
    limits: STORAGE_LIMITS,
    size: calculateRecordBytes,
    exportRecord: (table, record) => table === 'runs'
      ? { ...record as RunRecord, traceState: 'not-saved' } : record,
    failure: (code, message, path, projectId) => ({
      status: 'failed', code: 'limit', issues: [createIssue(code, message, path, projectId)],
    }),
    reader: stores ? {
      project: projectId => stores.projects.get(projectId),
      rows,
      count: async (table, projectId) => (await rows(table, projectId)).length,
      hasRun: async (projectId, runId) => !!await stores.runs.get([projectId, runId]),
      pinnedRunIds: async projectId => (await computeProjectPinClosureFromStores(stores, projectId))?.pinnedRunIds ?? [],
    } : {
      project: projectId => db.projects.get(projectId),
      rows: (table, projectId) => table === 'traceChunks'
        ? db.traceChunks.where('[projectId+runId]').between([projectId, ''], [projectId, '\uffff'], true, true).toArray()
        : db[table].where('projectId').equals(projectId).toArray(),
      count: (table, projectId) => table === 'traceChunks'
        ? db.traceChunks.where('[projectId+runId]').between([projectId, ''], [projectId, '\uffff'], true, true).count()
        : db[table].where('projectId').equals(projectId).count(),
      hasRun: async (projectId, runId) => !!await db.runs.get([projectId, runId]),
      pinnedRunIds: async projectId => (await computeProjectPinClosure(db, projectId))?.pinnedRunIds ?? [],
    },
  });
}

export function enforceProjectLimits(db: StudioDatabase, additions: LimitCheckAdditions, stores?: TransactionStores<ProjectStorageRows>): Promise<FailedResult | null> {
  return accounting(db, stores).check(additions);
}
export function enforceRunRetentionLimits(db: StudioDatabase, projectId: string, newRunId: string): Promise<FailedResult | null> {
  return accounting(db).checkRunRetention(projectId, newRunId);
}

