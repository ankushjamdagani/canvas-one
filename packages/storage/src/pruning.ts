import type { AtomicBackend, TransactionStores } from './index.js';
declare const structuredClone: <T>(value: T) => T;
export type ArtifactPruningRows = {
  projects: { readonly id: string; readonly revision: number; readonly updatedAt: number };
  runs: { readonly projectId: string; readonly id: string; readonly traceState: string };
  snapshots: unknown;
  traceChunks: unknown;
};
export type ArtifactPruningRequest = {
  readonly projectId: string; readonly expectedProjectRevision: number;
  readonly selection: { readonly runIds: readonly string[]; readonly traceRunIds: readonly string[]; readonly snapshotIds: readonly string[] };
};
export type ArtifactPruningChanges = {
  readonly projectRevision: number; readonly deletedRunIds: readonly string[];
  readonly tracePrunedRunIds: readonly string[]; readonly deletedSnapshotIds: readonly string[];
  readonly alreadyAbsentIds: readonly string[];
};
/** Retention mutations are portable; domain reference protection is checked inside the same transaction. */
export class ArtifactPruningCoordinator<Rows extends ArtifactPruningRows, Result> {
  constructor(private readonly options: {
    readonly backend: AtomicBackend<Rows>; readonly traceIndex: string; readonly pageSize?: number;
    readonly missing: (id: string) => Result; readonly stale: (expected: number, actual: number) => Result;
    readonly protect: (stores: TransactionStores<Rows>, project: Rows['projects'], request: ArtifactPruningRequest) => Promise<Result | null>;
    readonly applied: (changes: ArtifactPruningChanges) => Result;
    readonly failed: (error: unknown) => Result; readonly now?: () => number;
  }) {}
  async prune(input: ArtifactPruningRequest): Promise<Result> {
    try {
      const request = structuredClone(input);
      return await this.options.backend.transaction(async stores => {
        const { projectId, selection } = request;
        const project = await stores.projects.get(projectId);
        if (!project) return this.options.missing(projectId);
        if (project.revision !== request.expectedProjectRevision) return this.options.stale(request.expectedProjectRevision, project.revision);
        const rejected = await this.options.protect(stores, project, request);
        if (rejected != null) return rejected;
        const runById = new Map<string, Rows['runs']>();
        for (const id of [...selection.traceRunIds, ...selection.runIds]) {
          const row = await stores.runs.get([projectId, id]);
          if (row) runById.set(id, row);
        }
        const removeTrace = async (runId: string) => {
          for (;;) {
            const page = await stores.traceChunks.query(this.options.traceIndex, [projectId, runId], this.options.pageSize ?? 1000);
            for (const entry of page.entries) await stores.traceChunks.delete(entry.key);
            if (!page.truncated) return;
          }
        };
        const alreadyAbsentIds: string[] = []; const deletedRunIds: string[] = [];
        const tracePrunedRunIds: string[] = []; const deletedSnapshotIds: string[] = [];
        for (const id of selection.traceRunIds) {
          const row = runById.get(id);
          if (!row) { alreadyAbsentIds.push(id); continue; }
          await removeTrace(id);
          if (row.traceState !== 'pruned') await stores.runs.put([projectId, id], { ...row, traceState: 'pruned' });
          tracePrunedRunIds.push(id);
        }
        for (const id of selection.runIds) {
          if (!runById.has(id)) { alreadyAbsentIds.push(id); continue; }
          await removeTrace(id);
          await stores.runs.delete([projectId, id]);
          deletedRunIds.push(id);
        }
        for (const id of selection.snapshotIds) {
          if (!await stores.snapshots.get([projectId, id])) { alreadyAbsentIds.push(id); continue; }
          await stores.snapshots.delete([projectId, id]);
          deletedSnapshotIds.push(id);
        }
        const projectRevision = project.revision + 1;
        if (!Number.isSafeInteger(projectRevision)) throw new RangeError('Project revision limit reached');
        await stores.projects.put(projectId, { ...project, revision: projectRevision, updatedAt: (this.options.now ?? Date.now)() });
        return this.options.applied({ projectRevision, deletedRunIds, tracePrunedRunIds, deletedSnapshotIds, alreadyAbsentIds });
      });
    } catch (error) { return this.options.failed(error); }
  }
}
