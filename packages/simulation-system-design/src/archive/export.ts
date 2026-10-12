declare const TextEncoder: { new(): { encode(text: string): Uint8Array } };
import { stripStorageNamespace } from '@canvas-one/storage';
import { canonicalJson, sha256Hex } from '@canvas-one/system-design/studio/canonical';
import { createIssue } from '@canvas-one/system-design/studio/issue';
import { PORTABLE_FORMAT, PORTABLE_VERSION, DEFAULT_ARCHIVE_LIMITS, type ArchiveExportOptions, type ExportProjectParams, type ExportProjectResult, type ArchiveReadSnapshot, type ProjectBundle } from './contracts.js';

/** Consistent storage reads finish before canonical encoding or hashing begins. */
export async function exportProjectArchive(params: ExportProjectParams, options: ArchiveExportOptions): Promise<ExportProjectResult> {
  const { projectId } = params;
  const limits = options.limits ?? DEFAULT_ARCHIVE_LIMITS;
    // No `mintId` was injected at construction -- fail fast, before doing any work, rather
    // than inventing a downloadId.
    if (!options.mintId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'missing-property',
            options.missingMintIdMessage ?? 'exportProject requires an injected mintId; none was provided',
            ['mintId'],
          ),
        ],
      };
    }
    const mintId = options.mintId;

  let read: ArchiveReadSnapshot;
  try {
    const outcome = await options.reader.read(params);
    if (outcome.status !== 'read') return outcome;
    read = outcome.data;
  } catch (error) { return options.mapError(error); }
    const bundle: ProjectBundle = {
      id: read.project.id,
      title: read.project.title,
      createdAt: read.project.createdAt,
      updatedAt: read.project.updatedAt,
      mainBranchId: read.project.mainBranchId,
      initialSnapshotId: read.project.initialSnapshotId,
      branches: read.branches.map(stripStorageNamespace).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      snapshots: read.snapshots
        .map(stripStorageNamespace)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      commits: read.commits.map(stripStorageNamespace).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      publications: read.publications
        .map(stripStorageNamespace)
        .sort((a, b) => a.ordinal - b.ordinal),
      checkpoints: read.checkpoints
        .map(stripStorageNamespace)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      runs: read.runs
        .map((r) => ({ ...stripStorageNamespace(r), traceState: 'not-saved' as const }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      parts: read.parts
        .map(stripStorageNamespace)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision)),
    };

    const envelope = { format: PORTABLE_FORMAT, version: PORTABLE_VERSION, project: bundle };
    const canon = canonicalJson(envelope);
    if (!canon.ok) {
      return {
        status: 'failed',
        code: 'limit',
        issues: canon.issues,
      };
    }
    if (canon.bytes > limits.maxExportEnvelopeBytes) {
      return {
        status: 'failed',
        code: 'limit',
        issues: [
          createIssue(
            'too-large',
            `Export envelope is ${canon.bytes} bytes, exceeding the ${limits.maxExportEnvelopeBytes}-byte (64 MiB) cap; nothing was written`,
            [],
            projectId,
          ),
        ],
      };
    }

    let sha256: string;
    try {
      sha256 = await sha256Hex(canon.text);
    } catch (err) {
      return options.mapError(err);
    }
    const bytes = new TextEncoder().encode(canon.text);
    const downloadId = mintId();

    return {
      status: 'done',
      value: { kind: 'download', downloadId },
      bytes,
      sha256,
    };
}
