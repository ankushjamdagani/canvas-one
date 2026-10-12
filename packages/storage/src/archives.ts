/** Portable records omit their local project namespace; archive semantics belong to the host. */
export type PortableRow<Row extends { readonly projectId: string }> = Omit<Row, 'projectId'>;

export function stripStorageNamespace<Row extends { readonly projectId: string }>(row: Row): PortableRow<Row> {
  const { projectId: _projectId, ...portable } = row;
  return portable;
}

/** Hosts guarantee the snapshot is read atomically at the requested revision. */
export interface ConsistentArchiveReader<Scope, Snapshot, Failure> {
  read(scope: Scope): Promise<{ readonly status: 'read'; readonly data: Snapshot } | Failure>;
}
