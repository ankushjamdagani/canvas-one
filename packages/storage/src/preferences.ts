import type { AtomicBackend } from './index.js';
export type SnapshotRecord<Document> = { readonly projectId: string; readonly id: string; readonly document: Document };
export type PreferenceRecord<Schema extends string = string, Value = unknown> = { readonly key: string; readonly schema: Schema; readonly revision: number; readonly value: Value };
export type PreferencesResult<Value, Failure> = { readonly status: 'applied'; readonly revision: number; readonly value: Value }
  | { readonly status: 'stale'; readonly scope: 'preferences'; readonly expected: number; readonly actual: number } | Failure;
declare const structuredClone: <T>(value: T) => T;
export class PreferenceService<Schema extends string, Value, Failure> {
  constructor(private readonly options: {
    readonly backend: AtomicBackend<{ preferences: PreferenceRecord<Schema, Value> }>;
    readonly schema: Schema;
    readonly validate?: (value: Value) => Failure | null;
    readonly failed: (error: unknown) => Failure;
  }) {}
  async load(key = 'user'): Promise<Readonly<PreferenceRecord<Schema, Value>> | null> {
    return this.options.backend.transaction(async stores => { const row = await stores.preferences.get(key); return row ? Object.freeze(structuredClone(row)) : null; });
  }
  async save(expectedRevision: number, input: Value, key = 'user'): Promise<PreferencesResult<Value, Failure>> {
    try {
      const value = structuredClone(input);
      const invalid = this.options.validate?.(value); if (invalid != null) return invalid;
      return await this.options.backend.transaction(async stores => {
        const previous = await stores.preferences.get(key); const revision = previous?.revision ?? 0;
        if (revision !== expectedRevision) return { status: 'stale', scope: 'preferences', expected: expectedRevision, actual: revision };
        const nextRevision = revision + 1;
        await stores.preferences.put(key, { key, schema: this.options.schema, revision: nextRevision, value });
        return { status: 'applied', revision: nextRevision, value: Object.freeze(structuredClone(value)) };
      });
    } catch (error) { return this.options.failed(error); }
  }
}
