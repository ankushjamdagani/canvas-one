import { checkReceipt, type AtomicBackend, type OperationReceipt, type StorageKey, type StorageScan, type StoragePage, type TransactionStores } from './index.js';

export type CatalogProject = { readonly id: string; readonly title: string; readonly revision: number; readonly createdAt: number; readonly updatedAt: number };
export type ProjectRecord<Metadata extends object = Record<never, never>> = CatalogProject & Metadata;
/** Catalog reads use the same store port as writes, with no domain interpretation. */
export class ProjectCatalogReader<Project extends CatalogProject> {
  constructor(private readonly backend: AtomicBackend<{ projects: Project }>, private readonly pageSize = 1000) {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10000) throw new RangeError('Catalog page size must be between 1 and 10000');
  }
  async load(id: string): Promise<Readonly<Project> | null> {
    return this.backend.transaction(async stores => { const row = await stores.projects.get(id); return row ? Object.freeze(structuredClone(row)) : null; });
  }
  async list(): Promise<readonly Readonly<Project>[]> {
    return this.backend.transaction(async stores => {
      const rows: Project[] = [];
      let after: StorageKey | undefined;
      do {
        const page = await stores.projects.scan({ limit: this.pageSize, ...(after === undefined ? {} : { after }) });
        rows.push(...page.entries.map(entry => entry.row));
        if (!page.truncated) break;
        after = page.entries[page.entries.length - 1]!.key;
      } while (true);
      rows.sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return Object.freeze(rows.map(row => Object.freeze(structuredClone(row))));
    });
  }
}
export type CatalogResult<Project> =
  | { readonly status: 'applied'; readonly project: Project | null }
  | { readonly status: 'missing' }
  | { readonly status: 'stale'; readonly actualRevision: number }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'operation-reused' }
  | { readonly status: 'failed'; readonly error: unknown };
export type CatalogRows<Project> = { projects: Project; operations: OperationReceipt<CatalogResult<Project>> };
export type CatalogRequest<Project> = { readonly operationId: string; readonly projectId: string } & (
  | { readonly kind: 'create'; readonly project: Project }
  | { readonly kind: 'rename'; readonly expectedRevision: number; readonly title: string }
  | { readonly kind: 'delete'; readonly expectedRevision: number }
);
export type ProjectCatalogOptions<Project extends CatalogProject, Rows extends CatalogRows<Project>> = {
  readonly backend: AtomicBackend<Rows>;
  readonly fingerprint: (request: CatalogRequest<Project>) => string | Promise<string>;
  readonly validate: (project: Project) => string | null;
  readonly rename: (project: Project, title: string, revision: number, updatedAt: number) => Project;
  readonly now?: () => number;
  readonly projectKey?: (id: string) => StorageKey;
  readonly receiptKey?: (projectId: string, operationId: string) => StorageKey;
  /** Required related-row writes/deletions stay in the same transaction, not post-commit observers. */
  readonly onCreate?: (stores: TransactionStores<Rows>, project: Project) => Promise<void>;
  readonly onRename?: (stores: TransactionStores<Rows>, before: Project, after: Project) => Promise<void>;
  readonly onDelete?: (stores: TransactionStores<Rows>, project: Project) => Promise<void>;
};

/** Project metadata lifecycle; document/branch/evidence codecs are supplied by the host. */
export class ProjectCatalog<Project extends CatalogProject, Rows extends CatalogRows<Project> = CatalogRows<Project>> {
  constructor(private readonly options: ProjectCatalogOptions<Project, Rows>) {}
  load(id: string): Promise<Project | undefined> {
    return this.options.backend.transaction(stores => stores.projects.get(this.projectKey(id)));
  }
  list(options: StorageScan): Promise<StoragePage<Project>> {
    return this.options.backend.transaction(stores => stores.projects.scan(options));
  }
  async execute(request: CatalogRequest<Project>): Promise<CatalogResult<Project>> {
    if (!request || typeof request.operationId !== 'string' || !request.operationId || typeof request.projectId !== 'string' || !request.projectId || !['create', 'rename', 'delete'].includes(request.kind)) return { status: 'invalid', message: 'Project and operation identities are required' };
    if (request.kind !== 'create' && (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)) return { status: 'invalid', message: 'Expected revision must be a nonnegative safe integer' };
    if (request.kind === 'create' && (!request.project || request.project.id !== request.projectId || request.project.revision !== 0 || typeof request.project.title !== 'string' || !Number.isFinite(request.project.createdAt) || !Number.isFinite(request.project.updatedAt))) return { status: 'invalid', message: 'New project requires matching identity, zero revision, title and finite timestamps' };
    if (request.kind === 'rename' && typeof request.title !== 'string') return { status: 'invalid', message: 'Project title must be a string' };
    try {
      const immutableRequest = structuredClone(request);
      const hash = await this.options.fingerprint(immutableRequest);
      if (!hash) return { status: 'invalid', message: 'Request fingerprint is required' };
      return await this.options.backend.transaction(async stores => {
        const receiptKey = this.options.receiptKey?.(immutableRequest.projectId, immutableRequest.operationId) ?? [immutableRequest.projectId, immutableRequest.operationId];
        const replay = await checkReceipt({ get: () => stores.operations.get(receiptKey) }, immutableRequest.projectId, immutableRequest.operationId, hash);
        if (replay.kind === 'replay') return replay.result;
        if (replay.kind === 'reused') return { status: 'operation-reused' };
        const current = await stores.projects.get(this.projectKey(immutableRequest.projectId));
        let result: CatalogResult<Project>;
        if (immutableRequest.kind === 'create') {
          if (current) return { status: 'invalid', message: 'Project already exists' };
          const error = this.options.validate(immutableRequest.project);
          if (error) return { status: 'invalid', message: error };
          await stores.projects.add(this.projectKey(immutableRequest.projectId), immutableRequest.project);
          await this.options.onCreate?.(stores, immutableRequest.project);
          result = { status: 'applied', project: immutableRequest.project };
        } else {
          if (!current) return { status: 'missing' };
          if (current.revision !== immutableRequest.expectedRevision) return { status: 'stale', actualRevision: current.revision };
          if (immutableRequest.kind === 'delete') {
            await this.options.onDelete?.(stores, current);
            await stores.projects.delete(this.projectKey(current.id));
            result = { status: 'applied', project: null };
          } else {
            if (current.revision === Number.MAX_SAFE_INTEGER) return { status: 'invalid', message: 'Project revision limit reached' };
            const project = this.options.rename(current, immutableRequest.title, current.revision + 1, (this.options.now ?? Date.now)());
            if (project.id !== current.id || project.revision !== current.revision + 1 || project.title !== immutableRequest.title || project.createdAt !== current.createdAt) return { status: 'invalid', message: 'Rename codec changed project identity or revision incorrectly' };
            const error = this.options.validate(project);
            if (error) return { status: 'invalid', message: error };
            await this.options.onRename?.(stores, current, project);
            await stores.projects.put(this.projectKey(project.id), project);
            result = { status: 'applied', project };
          }
        }
        await stores.operations.add(receiptKey, { projectId: immutableRequest.projectId, id: immutableRequest.operationId, requestHash: hash, result, createdAt: (this.options.now ?? Date.now)() });
        return result;
      });
    } catch (error) { return { status: 'failed', error }; }
  }
  private projectKey(id: string): StorageKey { return this.options.projectKey?.(id) ?? id; }
}
declare const structuredClone: <T>(value: T) => T;
