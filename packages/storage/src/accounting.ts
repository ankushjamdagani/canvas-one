export type AccountedBytes = { readonly localBytes: number; readonly exportBytes: number };
export type AccountingTable = 'branches' | 'snapshots' | 'commits' | 'publications' | 'checkpoints' | 'runs' | 'parts' | 'operations' | 'traceChunks';
export type LimitCheckAdditions = {
  readonly projectId: string; readonly additionalLocalBytes?: number; readonly additionalExportBytes?: number;
  readonly additionalBranches?: number; readonly additionalCommits?: number; readonly additionalCheckpoints?: number;
  readonly additionalRuns?: number; readonly additionalParts?: number; readonly additionalReceipts?: number;
};
export type ProjectAccountingLimits = {
  readonly maxLocalProjectBytes: number; readonly maxExportEnvelopeBytes: number;
  readonly maxBranchesPerProject: number; readonly maxCommitsPerProject: number; readonly maxCheckpointsPerProject: number;
  readonly maxRunSummariesPerProject: number; readonly maxPartRevisionsPerProject: number; readonly maxReceiptsPerProject: number;
};
/** Read ports may bind an existing scoped transaction. Bytes/codecs and reference pinning are host policies. */
export type ProjectAccountingOptions<Failure> = {
  readonly limits: ProjectAccountingLimits;
  readonly reader: {
    project(projectId: string): Promise<unknown>;
    rows(table: AccountingTable, projectId: string): Promise<readonly unknown[]>;
    count(table: AccountingTable, projectId: string): Promise<number>;
    hasRun(projectId: string, runId: string): Promise<boolean>;
    pinnedRunIds(projectId: string): Promise<readonly string[]>;
  };
  readonly size: (record: unknown) => number;
  readonly exportRecord: (table: AccountingTable, record: unknown) => unknown;
  readonly failure: (code: 'too-many' | 'too-large', message: string, path: readonly string[], projectId: string) => Failure;
};
/** Shared project accounting/count limits and explicit-prune retention; no database or execution imports. */
export class ProjectAccountingService<Failure> {
  constructor(private readonly options: ProjectAccountingOptions<Failure>) {}
  async accountedBytes(projectId: string): Promise<AccountedBytes> {
    let localBytes = 0; let exportBytes = 0;
    const project = await this.options.reader.project(projectId);
    if (project) { const size = this.options.size(project); localBytes += size; exportBytes += size; }
    for (const table of ['branches', 'snapshots', 'commits', 'publications', 'checkpoints', 'runs', 'parts', 'operations', 'traceChunks'] as const) {
      for (const record of await this.options.reader.rows(table, projectId)) {
        const size = this.options.size(record); localBytes += size;
        if (table !== 'operations' && table !== 'traceChunks') exportBytes += table === 'runs' ? this.options.size(this.options.exportRecord(table, record)) : size;
      }
    }
    return { localBytes, exportBytes };
  }
  async check(additions: LimitCheckAdditions): Promise<Failure | null> {
    const { projectId } = additions; const { limits, reader, failure } = this.options;
    const counts = [
      ['branches', 'additionalBranches', limits.maxBranchesPerProject, 'branches'],
      ['commits', 'additionalCommits', limits.maxCommitsPerProject, 'commits'],
      ['checkpoints', 'additionalCheckpoints', limits.maxCheckpointsPerProject, 'checkpoints'],
      ['runs', 'additionalRuns', limits.maxRunSummariesPerProject, 'run summaries'],
      ['parts', 'additionalParts', limits.maxPartRevisionsPerProject, 'part revisions'],
      ['operations', 'additionalReceipts', limits.maxReceiptsPerProject, 'operation receipts'],
    ] as const;
    for (const [table, key, maximum, label] of counts) {
      const added = additions[key] ?? 0;
      if (added <= 0) continue;
      const current = await reader.count(table, projectId);
      if (current + added > maximum) return failure('too-many', `Project ${label} count would exceed maximum limit of ${maximum} (current: ${current}, adding: ${added})`, [table], projectId);
    }
    const addLocal = additions.additionalLocalBytes ?? 0; const addExport = additions.additionalExportBytes ?? 0;
    if (addLocal > 0 || addExport > 0) {
      const { localBytes, exportBytes } = await this.accountedBytes(projectId);
      if (localBytes + addLocal > limits.maxLocalProjectBytes) return failure('too-large', `Total accounted local bytes would exceed 128 MiB limit (current: ${localBytes}, adding: ${addLocal}, max: ${limits.maxLocalProjectBytes})`, [], projectId);
      if (exportBytes + addExport > limits.maxExportEnvelopeBytes) return failure('too-large', `Export envelope bytes would exceed 64 MiB limit (current: ${exportBytes}, adding: ${addExport}, max: ${limits.maxExportEnvelopeBytes})`, [], projectId);
    }
    return null;
  }
  async checkRunRetention(projectId: string, runId: string): Promise<Failure | null> {
    const { reader, limits, failure } = this.options;
    if (await reader.hasRun(projectId, runId)) return null;
    const total = await reader.count('runs', projectId);
    if (total >= limits.maxRunSummariesPerProject) return failure('too-many', `Project run summaries count would exceed maximum limit of ${limits.maxRunSummariesPerProject} (current: ${total}, adding: 1)`, ['runs'], projectId);
    const pinned = new Set(await reader.pinnedRunIds(projectId));
    const runs = await reader.rows('runs', projectId);
    if (runs.filter(row => !pinned.has((row as { readonly id: string }).id)).length >= 20) return failure('too-many', 'Unpinned runs limit reached (20 unpinned runs). Explicit prune is required before storing additional runs.', ['runs'], projectId);
    return null;
  }
}
