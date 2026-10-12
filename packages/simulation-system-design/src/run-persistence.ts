import { canonicalJson, sha256Hex } from '@canvas-one/system-design/studio/canonical';
import { isValidUuid } from '@canvas-one/system-design/studio/ids';
import { createIssue } from '@canvas-one/system-design/studio/issue';
import type { Document, Id } from '@canvas-one/system-design/studio/model';
import { RepositoryError, type SnapshotRecord } from '@canvas-one/storage';
import { TERMINAL_STATUSES, type TraceEvent } from './runner/types.js';
import type { RunRecord, SaveRunResult, TraceChunkRecord } from './artifacts.js';
import type { TokenBinding } from './token.js';

export type PreparedRunArtifacts = {
  readonly run: RunRecord; readonly chunks: readonly TraceChunkRecord[];
  readonly snapshot?: SnapshotRecord<Document>;
};
export type RunPersistenceOptions<Code extends string> = {
  readonly validateToken: (token: unknown) => TokenBinding | null;
  readonly loadSnapshot: (projectId: Id, snapshotId: string) => Promise<unknown>;
  readonly loadRun: (projectId: Id, runId: Id) => Promise<unknown>;
  readonly computeSnapshotId: (document: Document) => Promise<string>;
  readonly calculateRecordBytes: (value: unknown) => number;
  readonly checkRetention: (projectId: Id, runId: Id) => Promise<Extract<SaveRunResult<Code>, { status: 'failed' }> | null>;
  readonly checkLimits: (additions: { readonly projectId: Id; readonly additionalLocalBytes: number; readonly additionalExportBytes: number; readonly additionalRuns: number }) => Promise<Extract<SaveRunResult<Code>, { status: 'failed' }> | null>;
  readonly commit: (artifacts: PreparedRunArtifacts) => Promise<SaveRunResult<Code>>;
};
/** Execution artifact validation/provenance and normalization, independent of its persistence backend. */
export class RunPersistenceService<Code extends string = string> {
  constructor(private readonly options: RunPersistenceOptions<Code>) {}
  async save(startToken: unknown, terminalResult: unknown, chunks?: unknown,
    options?: { projectId?: Id; document?: Document } | Id): Promise<SaveRunResult<Code>> {
    // 1. Verify start token against unforgeable registry
    const tokenBinding = this.options.validateToken(startToken);
    if (!tokenBinding) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Start token is invalid, forged, or not registered in the runner registry',
            ['startToken'],
          ),
        ],
      };
    }

    // 2. Validate token object against registry binding
    if (
      typeof startToken === 'object' &&
      startToken !== null &&
      ((startToken as any).runId !== tokenBinding.runId ||
        (startToken as any).snapshotId !== tokenBinding.snapshotId ||
        (startToken as any).fingerprint !== tokenBinding.fingerprint ||
        (startToken as any).projectId !== tokenBinding.projectId)
    ) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Start token object properties do not match registered binding',
            ['startToken'],
          ),
        ],
      };
    }

    // 3. Resolve project ID ONLY from the start token registry binding
    const projectId: Id = tokenBinding.projectId;
    if (!projectId || !isValidUuid(projectId)) {
      return {
        status: 'invalid',
        issues: [createIssue('invalid-id', 'Valid projectId is required in start token binding', ['projectId'])],
      };
    }

    // If caller-supplied projectId (options or terminalResult) disagrees with the binding -> invalid
    const callerProjectId = typeof options === 'string' ? options : options?.projectId;
    if (callerProjectId !== undefined && callerProjectId !== projectId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Caller-supplied projectId (${callerProjectId}) does not match start token binding (${projectId})`,
            ['projectId'],
          ),
        ],
      };
    }

    const termProjectId = (terminalResult as any)?.projectId;
    if (termProjectId !== undefined && termProjectId !== projectId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Terminal result projectId (${termProjectId}) does not match start token binding (${projectId})`,
            ['projectId'],
          ),
        ],
      };
    }

    // 4. Verify terminal result
    if (!terminalResult || typeof terminalResult !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('wrong-type', 'Terminal result must be an object', ['terminalResult'])],
      };
    }
    const term = terminalResult as any;

    // Requirement 3: terminalResult.runId must equal the binding's runId
    if (term.runId !== tokenBinding.runId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Run ID in terminal result (${String(term.runId)}) does not match start token binding (${tokenBinding.runId})`,
            ['runId'],
          ),
        ],
      };
    }

    // Requirement 3: terminal manifest fingerprint must equal the binding's fingerprint
    let termFingerprint =
      term.fingerprint ?? term.manifestFingerprint ?? (term.manifest as any)?.fingerprint;
    if (termFingerprint === undefined && term.manifest && typeof term.manifest === 'object') {
      try {
        const canon = canonicalJson(term.manifest);
        if (canon.ok) {
          termFingerprint = `ss-run-v1:${await sha256Hex(canon.text)}`;
        }
      } catch {
        // ignore error and let check fail below
      }
    }

    if (termFingerprint !== tokenBinding.fingerprint) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Manifest fingerprint in terminal result (${String(termFingerprint)}) does not match start token binding (${tokenBinding.fingerprint})`,
            ['fingerprint'],
          ),
        ],
      };
    }

    // Verify snapshotId match (if present on terminal result)
    if (term.snapshotId !== undefined && term.snapshotId !== tokenBinding.snapshotId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Snapshot ID in terminal result (${term.snapshotId}) does not match start token binding (${tokenBinding.snapshotId})`,
            ['snapshotId'],
          ),
        ],
      };
    }

    // Verify terminal status: only terminal statuses persist
    const status = term.status;
    if (!TERMINAL_STATUSES.includes(status)) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'invalid-literal',
            `Only terminal statuses persist; received non-terminal or unknown status '${String(status)}'`,
            ['status'],
          ),
        ],
      };
    }

    // Verify summary
    const summary = term.summary;
    if (!summary || typeof summary !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'Run summary is required to save run', ['summary'])],
      };
    }
    const checks = Array.isArray(term.checks) ? term.checks : [];

    // 5. Verify snapshot row exists or insert-if-absent from supplied document
    const snapshotKey: [string, string] = [projectId, tokenBinding.snapshotId];
    const existingSnapshot = await this.options.loadSnapshot(projectId, tokenBinding.snapshotId);
    const documentToInsert: Document | undefined =
      typeof options === 'object' && options?.document
        ? options.document
        : tokenBinding.document ?? term.document;

    if (!existingSnapshot) {
      if (documentToInsert) {
        try {
          const computedSnapId = await this.options.computeSnapshotId(documentToInsert);
          if (computedSnapId !== tokenBinding.snapshotId) {
            return {
              status: 'invalid',
              issues: [
                createIssue(
                  'structural-rule',
                  `Provided document snapshot ID (${computedSnapId}) does not match token snapshot ID (${tokenBinding.snapshotId})`,
                  ['snapshotId'],
                ),
              ],
            };
          }
        } catch (err) {
          if (err instanceof RepositoryError && err.code === 'invalid') {
            return {
              status: 'invalid',
              issues: err.issues ?? [createIssue('structural-rule', err.message, ['document'])],
            };
          }
          throw err;
        }
      } else {
        return {
          status: 'invalid',
          issues: [
            createIssue(
              'dangling-reference',
              `Snapshot '${tokenBinding.snapshotId}' does not exist for project '${projectId}' and no document was supplied`,
              ['snapshotId'],
            ),
          ],
        };
      }
    }

    // 5. Check retention & limits before mutation
    const retentionLimitResult = await this.options.checkRetention(projectId, tokenBinding.runId);
    if (retentionLimitResult) {
      return retentionLimitResult;
    }

    // Normalize chunks
    const chunkRecords: TraceChunkRecord[] = [];
    let chunksAreSaved = false;

    if (chunks !== null && chunks !== undefined) {
      chunksAreSaved = true;
      if (Array.isArray(chunks)) {
        if (chunks.length > 0) {
          if ('events' in chunks[0] && Array.isArray((chunks[0] as any).events)) {
            for (let i = 0; i < chunks.length; i++) {
              const c = chunks[i] as any;
              const events = c.events;
              const firstSeq = c.firstSequence ?? (events.length > 0 ? events[0].sequence : 0);
              const payloads = c.payloads ?? null;
              const bLength = c.byteLength ?? this.options.calculateRecordBytes(events);
              chunkRecords.push({
                projectId,
                runId: tokenBinding.runId,
                index: c.index ?? i,
                firstSequence: firstSeq,
                events,
                payloads,
                byteLength: bLength,
              });
            }
          } else if ('kind' in chunks[0] && 'sequence' in chunks[0]) {
            const events = chunks as readonly TraceEvent[];
            chunkRecords.push({
              projectId,
              runId: tokenBinding.runId,
              index: 0,
              firstSequence: events[0].sequence,
              events,
              payloads: null,
              byteLength: this.options.calculateRecordBytes(events),
            });
          }
        }
      }
    }

    const now = Date.now();
    const runRecord: RunRecord = {
      projectId,
      id: tokenBinding.runId,
      snapshotId: tokenBinding.snapshotId,
      manifest: tokenBinding.manifest,
      fingerprint: tokenBinding.fingerprint,
      status,
      provenance: 'local', // set ONLY by the repository!
      checks,
      summary,
      traceState: chunksAreSaved ? 'complete' : 'not-saved',
      createdAt: tokenBinding.createdAt ?? now,
      completedAt: term.completedAt ?? now,
    };

    // Calculate added bytes for project limits
    let addLocalBytes = this.options.calculateRecordBytes(runRecord);
    let addExportBytes = this.options.calculateRecordBytes({ ...runRecord, traceState: 'not-saved' });
    for (const chunk of chunkRecords) {
      addLocalBytes += this.options.calculateRecordBytes(chunk);
    }
    if (!existingSnapshot && documentToInsert) {
      const snapRecord = { projectId, id: tokenBinding.snapshotId, document: documentToInsert };
      const snapBytes = this.options.calculateRecordBytes(snapRecord);
      addLocalBytes += snapBytes;
      addExportBytes += snapBytes;
    }

    const byteLimitResult = await this.options.checkLimits({
      projectId,
      additionalLocalBytes: addLocalBytes,
      additionalExportBytes: addExportBytes,
      additionalRuns: (await this.options.loadRun(projectId, tokenBinding.runId)) ? 0 : 1,
    });
    if (byteLimitResult) {
      return byteLimitResult;
    }


    return this.options.commit({
      run: runRecord, chunks: chunkRecords,
      ...(!existingSnapshot && documentToInsert ? {
        snapshot: { projectId, id: tokenBinding.snapshotId, document: documentToInsert },
      } : {}),
    });
  }
}
