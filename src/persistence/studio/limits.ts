/**
 * Limits enforcement and byte accounting for System Studio repository (RV-16a).
 *
 * Implements specs/revamp/contracts/storage.md §5 ("Export always fits") and §6 (Limits):
 * - accounted project bytes = per-record canonical UTF-8 sizes
 * - total accounted local bytes <= 128 MiB
 * - complete canonical export envelope <= 64 MiB
 * - Local-project counts:
 *   - 100 branches
 *   - 1,000 commits
 *   - 100 checkpoints
 *   - 200 run summaries
 *   - 100 part revisions
 *   - 100,000 receipts (operations)
 *
 * All limits are checked before mutations and fail with status 'failed' and code 'limit'.
 */

import { canonicalJson } from '../../domain/studio/canonical';
import type { StudioDatabase } from './db';
import { createIssue, RepositoryError } from './errors';
import { STORAGE_LIMITS, type FailedResult } from './types';

/**
 * Calculates the exact canonical-json-v1 UTF-8 byte length for a record.
 */
export function calculateRecordBytes(record: unknown): number {
  const result = canonicalJson(record);
  if (!result.ok) {
    throw new RepositoryError({
      code: 'invalid',
      message: 'Failed to compute canonical JSON size for record',
      issues: result.issues,
    });
  }
  return result.bytes;
}

export type AccountedBytes = {
  readonly localBytes: number;
  readonly exportBytes: number;
};

/**
 * Computes the total accounted local bytes and export envelope bytes for a given project.
 */
export async function getProjectAccountedBytes(
  db: StudioDatabase,
  projectId: string,
): Promise<AccountedBytes> {
  let localBytes = 0;
  let exportBytes = 0;

  // 1. Project record
  const project = await db.projects.get(projectId);
  if (project) {
    const b = calculateRecordBytes(project);
    localBytes += b;
    exportBytes += b;
  }

  // 2. Branches
  const branches = await db.branches.where('projectId').equals(projectId).toArray();
  for (const branch of branches) {
    const b = calculateRecordBytes(branch);
    localBytes += b;
    exportBytes += b;
  }

  // 3. Snapshots
  const snapshots = await db.snapshots.where('projectId').equals(projectId).toArray();
  for (const snapshot of snapshots) {
    const b = calculateRecordBytes(snapshot);
    localBytes += b;
    exportBytes += b;
  }

  // 4. Commits
  const commits = await db.commits.where('projectId').equals(projectId).toArray();
  for (const commit of commits) {
    const b = calculateRecordBytes(commit);
    localBytes += b;
    exportBytes += b;
  }

  // 5. Publications
  const publications = await db.publications.where('projectId').equals(projectId).toArray();
  for (const pub of publications) {
    const b = calculateRecordBytes(pub);
    localBytes += b;
    exportBytes += b;
  }

  // 6. Checkpoints
  const checkpoints = await db.checkpoints.where('projectId').equals(projectId).toArray();
  for (const cp of checkpoints) {
    const b = calculateRecordBytes(cp);
    localBytes += b;
    exportBytes += b;
  }

  // 7. Runs (exportable runs have traceState: 'not-saved')
  const runs = await db.runs.where('projectId').equals(projectId).toArray();
  for (const run of runs) {
    const b = calculateRecordBytes(run);
    localBytes += b;
    const exportRun =
      run.traceState === 'not-saved' ? run : { ...run, traceState: 'not-saved' as const };
    exportBytes += calculateRecordBytes(exportRun);
  }

  // 8. Parts
  const parts = await db.parts.where('projectId').equals(projectId).toArray();
  for (const part of parts) {
    const b = calculateRecordBytes(part);
    localBytes += b;
    exportBytes += b;
  }

  // 9. Operations (receipts - local only)
  const operations = await db.operations.where('projectId').equals(projectId).toArray();
  for (const op of operations) {
    localBytes += calculateRecordBytes(op);
  }

  // 10. Trace chunks (local only)
  const traceChunks = await db.traceChunks
    .where('[projectId+runId]')
    .between([projectId, ''], [projectId, '\uffff'], true, true)
    .toArray();
  for (const chunk of traceChunks) {
    localBytes += calculateRecordBytes(chunk);
  }

  return { localBytes, exportBytes };
}

export type LimitCheckAdditions = {
  readonly projectId: string;
  readonly additionalLocalBytes?: number;
  readonly additionalExportBytes?: number;
  readonly additionalBranches?: number;
  readonly additionalCommits?: number;
  readonly additionalCheckpoints?: number;
  readonly additionalRuns?: number;
  readonly additionalParts?: number;
  readonly additionalReceipts?: number;
};

/**
 * Enforces project count and byte limits BEFORE mutation.
 * Returns a FailedResult with code 'limit' if any limit would be exceeded, or null if all pass.
 */
export async function enforceProjectLimits(
  db: StudioDatabase,
  additions: LimitCheckAdditions,
): Promise<FailedResult | null> {
  const { projectId } = additions;

  // Check branch count limit
  if (additions.additionalBranches && additions.additionalBranches > 0) {
    const currentBranches = await db.branches.where('projectId').equals(projectId).count();
    if (currentBranches + additions.additionalBranches > STORAGE_LIMITS.maxBranchesPerProject) {
      return {
        status: 'failed',
        code: 'limit',
        issues: [
          createIssue(
            'too-many',
            `Project branches count would exceed maximum limit of ${STORAGE_LIMITS.maxBranchesPerProject} (current: ${currentBranches}, adding: ${additions.additionalBranches})`,
            ['branches'],
            projectId,
          ),
        ],
      };
    }
  }

  // Check commit count limit
  if (additions.additionalCommits && additions.additionalCommits > 0) {
    const currentCommits = await db.commits.where('projectId').equals(projectId).count();
    if (currentCommits + additions.additionalCommits > STORAGE_LIMITS.maxCommitsPerProject) {
      return {
        status: 'failed',
        code: 'limit',
        issues: [
          createIssue(
            'too-many',
            `Project commits count would exceed maximum limit of ${STORAGE_LIMITS.maxCommitsPerProject} (current: ${currentCommits}, adding: ${additions.additionalCommits})`,
            ['commits'],
            projectId,
          ),
        ],
      };
    }
  }

  // Check checkpoint count limit
  if (additions.additionalCheckpoints && additions.additionalCheckpoints > 0) {
    const currentCheckpoints = await db.checkpoints.where('projectId').equals(projectId).count();
    if (
      currentCheckpoints + additions.additionalCheckpoints >
      STORAGE_LIMITS.maxCheckpointsPerProject
    ) {
      return {
        status: 'failed',
        code: 'limit',
        issues: [
          createIssue(
            'too-many',
            `Project checkpoints count would exceed maximum limit of ${STORAGE_LIMITS.maxCheckpointsPerProject} (current: ${currentCheckpoints}, adding: ${additions.additionalCheckpoints})`,
            ['checkpoints'],
            projectId,
          ),
        ],
      };
    }
  }

  // Check run summaries limit
  if (additions.additionalRuns && additions.additionalRuns > 0) {
    const currentRuns = await db.runs.where('projectId').equals(projectId).count();
    if (currentRuns + additions.additionalRuns > STORAGE_LIMITS.maxRunSummariesPerProject) {
      return {
        status: 'failed',
        code: 'limit',
        issues: [
          createIssue(
            'too-many',
            `Project run summaries count would exceed maximum limit of ${STORAGE_LIMITS.maxRunSummariesPerProject} (current: ${currentRuns}, adding: ${additions.additionalRuns})`,
            ['runs'],
            projectId,
          ),
        ],
      };
    }
  }

  // Check part revisions limit
  if (additions.additionalParts && additions.additionalParts > 0) {
    const currentParts = await db.parts.where('projectId').equals(projectId).count();
    if (currentParts + additions.additionalParts > STORAGE_LIMITS.maxPartRevisionsPerProject) {
      return {
        status: 'failed',
        code: 'limit',
        issues: [
          createIssue(
            'too-many',
            `Project part revisions count would exceed maximum limit of ${STORAGE_LIMITS.maxPartRevisionsPerProject} (current: ${currentParts}, adding: ${additions.additionalParts})`,
            ['parts'],
            projectId,
          ),
        ],
      };
    }
  }

  // Check receipts (operations) limit
  if (additions.additionalReceipts && additions.additionalReceipts > 0) {
    const currentReceipts = await db.operations.where('projectId').equals(projectId).count();
    if (currentReceipts + additions.additionalReceipts > STORAGE_LIMITS.maxReceiptsPerProject) {
      return {
        status: 'failed',
        code: 'limit',
        issues: [
          createIssue(
            'too-many',
            `Project operation receipts count would exceed maximum limit of ${STORAGE_LIMITS.maxReceiptsPerProject} (current: ${currentReceipts}, adding: ${additions.additionalReceipts})`,
            ['operations'],
            projectId,
          ),
        ],
      };
    }
  }

  // Check byte limits
  const addLocal = additions.additionalLocalBytes ?? 0;
  const addExport = additions.additionalExportBytes ?? 0;

  if (addLocal > 0 || addExport > 0) {
    const { localBytes, exportBytes } = await getProjectAccountedBytes(db, projectId);

    if (localBytes + addLocal > STORAGE_LIMITS.maxLocalProjectBytes) {
      return {
        status: 'failed',
        code: 'limit',
        issues: [
          createIssue(
            'too-large',
            `Total accounted local bytes would exceed 128 MiB limit (current: ${localBytes}, adding: ${addLocal}, max: ${STORAGE_LIMITS.maxLocalProjectBytes})`,
            [],
            projectId,
          ),
        ],
      };
    }

    if (exportBytes + addExport > STORAGE_LIMITS.maxExportEnvelopeBytes) {
      return {
        status: 'failed',
        code: 'limit',
        issues: [
          createIssue(
            'too-large',
            `Export envelope bytes would exceed 64 MiB limit (current: ${exportBytes}, adding: ${addExport}, max: ${STORAGE_LIMITS.maxExportEnvelopeBytes})`,
            [],
            projectId,
          ),
        ],
      };
    }
  }

  return null;
}

/**
 * Enforces run retention limits and run summary caps per storage.md §6 & §7:
 * - 200 run summaries cap per project
 * - 20 latest unpinned runs retention rule ("Before storing a 21st, offer an explicit prune")
 * Returns a FailedResult with code 'limit' if any limit would be exceeded, or null if all pass.
 */
export async function enforceRunRetentionLimits(
  db: StudioDatabase,
  projectId: string,
  newRunId: string,
): Promise<FailedResult | null> {
  // If run already exists, re-saving it does not add an unpinned run
  const existing = await db.runs.get([projectId, newRunId]);
  if (existing) {
    return null;
  }

  // 1. Enforce 200 run-summaries cap (storage.md §6)
  const totalRuns = await db.runs.where('projectId').equals(projectId).count();
  if (totalRuns >= STORAGE_LIMITS.maxRunSummariesPerProject) {
    return {
      status: 'failed',
      code: 'limit',
      issues: [
        createIssue(
          'too-many',
          `Project run summaries count would exceed maximum limit of ${STORAGE_LIMITS.maxRunSummariesPerProject} (current: ${totalRuns}, adding: 1)`,
          ['runs'],
          projectId,
        ),
      ],
    };
  }

  // 2. Enforce 20 unpinned runs retention rule (storage.md §7:
  // "Keep the 20 latest unpinned runs by (completedAt,id). Before storing a 21st, offer an explicit prune")
  // A run is pinned when a retained commit references it.
  const commits = await db.commits.where('projectId').equals(projectId).toArray();
  const pinnedRunIds = new Set<string>();
  for (const commit of commits) {
    if (Array.isArray(commit.evidence)) {
      for (const ev of commit.evidence) {
        if (ev && typeof ev.runId === 'string') {
          pinnedRunIds.add(ev.runId);
        }
      }
    }
  }

  const allRuns = await db.runs.where('projectId').equals(projectId).toArray();
  let unpinnedCount = 0;
  for (const run of allRuns) {
    if (!pinnedRunIds.has(run.id)) {
      unpinnedCount++;
    }
  }

  if (unpinnedCount >= 20) {
    return {
      status: 'failed',
      code: 'limit',
      issues: [
        createIssue(
          'too-many',
          'Unpinned runs limit reached (20 unpinned runs). Explicit prune is required before storing additional runs.',
          ['runs'],
          projectId,
        ),
      ],
    };
  }

  return null;
}

