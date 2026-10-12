import { createIssue, type ValidationIssue } from './index.js';
import type { BoardDocument } from './document.js';

export type ContributionKind = 'schema' | 'migration' | 'component' | 'command' | 'tool' | 'panel' | 'importer' | 'exporter' | 'execution-provider';
export type ExtensionDependency = { readonly id: string; readonly version: string };
export type ExtensionManifest = {
  readonly id: string; readonly version: string; readonly dependencies: readonly ExtensionDependency[];
  readonly capabilities: readonly string[];
};
export type ExtensionContribution = {
  readonly id: string; readonly kind: ContributionKind; readonly version: string;
  readonly capabilities: readonly string[]; readonly value: unknown; readonly dispose?: () => void;
};
export type ExtensionDefinition = {
  readonly manifest: ExtensionManifest; readonly contributions: readonly ExtensionContribution[]; readonly dispose?: () => void;
};
export type ExtensionRegistrationResult =
  | { readonly ok: true; readonly unregister: () => ExtensionRemovalResult }
  | { readonly ok: false; readonly code: 'invalid-manifest' | 'duplicate-extension' | 'duplicate-contribution' | 'missing-dependency' | 'incompatible-version' | 'host-unavailable'; readonly message: string };
export type ExtensionRemovalResult =
  | { readonly ok: true; readonly errors: readonly unknown[] }
  | { readonly ok: false; readonly code: 'required-by-extension' | 'host-unavailable'; readonly dependents: readonly string[] };
const namespaced = (id: string) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*[/:][a-zA-Z0-9._:/-]+$/.test(id);
const versionParts = (version: string) => typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ? version.split('.').map(Number) : null;

/** Exact and caret version requirements; unsupported range syntax is explicitly rejected. */
export function isExtensionVersionCompatible(actual: string, required: string): boolean {
  if (typeof required !== 'string') return false;
  const a = versionParts(actual); const caret = required.startsWith('^'); const r = versionParts(caret ? required.slice(1) : required);
  if (!a || !r) return false;
  if (!caret) return actual === required;
  const lower = a[0] > r[0] || a[0] === r[0] && (a[1] > r[1] || a[1] === r[1] && a[2] >= r[2]);
  const upper = r[0] > 0 ? a[0] === r[0] : r[1] > 0 ? a[0] === 0 && a[1] === r[1] : a[0] === 0 && a[1] === 0 && a[2] === r[2];
  return lower && upper;
}

/** Trusted host registration only. Unknown authored extension records never enter this registry. */
export function createExtensionRegistry() {
  const extensions = new Map<string, ExtensionDefinition>();
  const contributions = new Map<string, { readonly extensionId: string; readonly contribution: ExtensionContribution }>();
  const key = (kind: ContributionKind, id: string) => `${kind}\u0000${id}`;
  const unregister = (id: string): ExtensionRemovalResult => {
    const definition = extensions.get(id);
    if (!definition) return { ok: true, errors: [] };
    const dependents = [...extensions.values()].filter((entry) => entry.manifest.dependencies.some((dependency) => dependency.id === id)).map((entry) => entry.manifest.id);
    if (dependents.length) return { ok: false, code: 'required-by-extension', dependents };
    extensions.delete(id);
    for (const contribution of definition.contributions) contributions.delete(key(contribution.kind, contribution.id));
    const errors: unknown[] = [];
    for (const contribution of [...definition.contributions].reverse()) { try { contribution.dispose?.(); } catch (error) { errors.push(error); } }
    try { definition.dispose?.(); } catch (error) { errors.push(error); }
    return { ok: true, errors };
  };
  return {
    register(definition: ExtensionDefinition): ExtensionRegistrationResult {
      const m = definition?.manifest;
      const fail = (code: Exclude<ExtensionRegistrationResult, { ok: true }>['code'], message: string): ExtensionRegistrationResult => ({ ok: false, code, message });
      if (!m || !namespaced(m.id) || !versionParts(m.version) || !Array.isArray(m.dependencies) || !Array.isArray(m.capabilities) || m.capabilities.some((capability: unknown) => typeof capability !== 'string' || !capability) || !Array.isArray(definition.contributions)) return fail('invalid-manifest', 'Extension requires a namespaced id, semantic version, dependencies, capabilities and contributions');
      if (extensions.has(m.id)) return fail('duplicate-extension', `Extension ${m.id} is already registered`);
      const dependencyIds = new Set<string>();
      for (const dependency of m.dependencies) {
        if (!dependency || !namespaced(dependency.id) || dependencyIds.has(dependency.id) || dependency.id === m.id) return fail('invalid-manifest', 'Dependencies must have unique namespaced identifiers and cannot refer to self');
        dependencyIds.add(dependency.id);
        const actual = extensions.get(dependency.id)?.manifest.version;
        if (!actual) return fail('missing-dependency', `Missing extension ${dependency.id}`);
        if (!isExtensionVersionCompatible(actual, dependency.version)) return fail('incompatible-version', `${dependency.id} ${actual} does not satisfy ${dependency.version}`);
      }
      const seen = new Set<string>();
      const kinds: readonly ContributionKind[] = ['schema', 'migration', 'component', 'command', 'tool', 'panel', 'importer', 'exporter', 'execution-provider'];
      for (const contribution of definition.contributions) {
        if (!contribution || !namespaced(contribution.id) || !versionParts(contribution.version) || !kinds.includes(contribution.kind) || !Array.isArray(contribution.capabilities) || contribution.capabilities.some((capability: unknown) => typeof capability !== 'string' || !capability)) return fail('invalid-manifest', 'Contribution requires a namespaced id, semantic version, kind and capabilities');
        const contributionKey = key(contribution.kind, contribution.id);
        if (seen.has(contributionKey) || contributions.has(contributionKey)) return fail('duplicate-contribution', `Duplicate ${contribution.kind} ${contribution.id}`);
        seen.add(contributionKey);
      }
      const stored: ExtensionDefinition = Object.freeze({ ...definition, manifest: Object.freeze({ ...m, dependencies: Object.freeze(m.dependencies.map((entry) => Object.freeze({ ...entry }))), capabilities: Object.freeze([...m.capabilities]) }), contributions: Object.freeze(definition.contributions.map((entry) => Object.freeze({ ...entry, capabilities: Object.freeze([...entry.capabilities]) }))) });
      extensions.set(m.id, stored);
      for (const contribution of stored.contributions) contributions.set(key(contribution.kind, contribution.id), Object.freeze({ extensionId: m.id, contribution }));
      return { ok: true, unregister: () => extensions.get(m.id) === stored ? unregister(m.id) : { ok: true, errors: [] } };
    },
    getManifest(id: string): ExtensionManifest | undefined { return extensions.get(id)?.manifest; },
    getContribution(kind: ContributionKind, id: string) { return contributions.get(key(kind, id)); },
    list(): readonly ExtensionManifest[] { return Object.freeze([...extensions.values()].map((entry) => entry.manifest)); },
    listContributions(kind?: ContributionKind) { return Object.freeze([...contributions.values()].filter(entry => !kind || entry.contribution.kind === kind).sort((a, b) => a.contribution.id.localeCompare(b.contribution.id))); },
    require(id: string, version: string): { readonly supported: true } | { readonly supported: false; readonly reason: string } {
      const actual = extensions.get(id)?.manifest.version;
      return actual && isExtensionVersionCompatible(actual, version) ? { supported: true } : { supported: false, reason: actual ? `Incompatible extension ${id} ${actual}` : `Unavailable extension ${id}` };
    },
    dispose(): readonly unknown[] {
      const errors: unknown[] = [];
      // Registration requires dependencies first, so reverse order removes dependents first.
      for (const id of [...extensions.keys()].reverse()) { const result = unregister(id); if (result.ok) errors.push(...result.errors); }
      return errors;
    },
  };
}

/** Validate a single extension record's data field. Return issues; empty array means valid. */
export type ExtensionSchemaValidator = (data: unknown, path: readonly (string | number)[]) => readonly ValidationIssue[];

export type ExtensionDispatchResult =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly error?: unknown };

/** Called with the contribution's input; resolves to a dispatch result. */
export type ExtensionCommandHandler = (input: unknown) => Promise<ExtensionDispatchResult>;
export type ExtensionToolHandler = (input: unknown) => Promise<ExtensionDispatchResult>;
export type ExtensionExecutionProvider = {
  readonly execute: (spec: unknown) => Promise<ExtensionDispatchResult>;
};

export type ExtensionHostDispatchResult =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly code: 'missing-contribution' | 'execution-error'; readonly message: string; readonly error?: unknown };

/**
 * Wraps createExtensionRegistry with typed dispatch for schema, command, tool and
 * execution-provider contributions. The registry lifecycle (register/unregister/dispose)
 * is delegated through unchanged.
 *
 * Integration: compose `host.validateExtensionRecords` into the board's `validate` function
 * to make extension schema contributions affect authored document validation.
 */
export function createExtensionHost(options: {readonly canModify?: () => boolean} = {}) {
  const registry = createExtensionRegistry();
  let disposed = false;

  const dispatchHandler = async (kind: 'command' | 'tool', id: string, input: unknown): Promise<ExtensionHostDispatchResult> => {
    const entry = registry.getContribution(kind, id);
    if (!entry) return { ok: false, code: 'missing-contribution', message: `${kind} ${id} not registered` };
    try {
      const handler = entry.contribution.value as ExtensionCommandHandler;
      const result = await handler(input);
      return result.ok ? { ok: true, output: result.output } : { ok: false, code: 'execution-error', message: result.message, error: result.error };
    } catch (error) {
      return { ok: false, code: 'execution-error', message: `${kind} ${id} threw`, error };
    }
  };

  return {
    register(definition: ExtensionDefinition): ExtensionRegistrationResult {
      if (disposed || options.canModify?.() === false) return {ok: false, code: 'host-unavailable', message: 'Extension changes require an open, idle host'};
      const registered = registry.register(definition);
      return registered.ok ? {...registered, unregister: () => disposed || options.canModify?.() === false
        ? {ok: false, code: 'host-unavailable', dependents: []} : registered.unregister()} : registered;
    },
    getManifest(id: string): ExtensionManifest | undefined {
      return registry.getManifest(id);
    },
    getContribution(kind: ContributionKind, id: string) {
      return registry.getContribution(kind, id);
    },
    list(): readonly ExtensionManifest[] {
      return registry.list();
    },
    listContributions(kind?: ContributionKind) {return registry.listContributions(kind);},
    require(id: string, version: string) {
      return registry.require(id, version);
    },

    /** Run registered schema validators for each extension key in the given records map.
     *  Unknown extensions (no schema registered) are preserved without issues. */
    validateExtensionRecords(
      records: Readonly<Record<string, { readonly version: string; readonly data: unknown }>>,
      path: readonly (string | number)[],
    ): readonly ValidationIssue[] {
      const issues: ValidationIssue[] = [];
      for (const [id, record] of Object.entries(records)) {
        const entry = registry.getContribution('schema', id);
        if (!entry) continue;
        if (record.version !== entry.contribution.version) {
          issues.push(createIssue('extension/incompatible-version', `Extension ${id} requires schema ${record.version}; installed schema is ${entry.contribution.version}. Migrate explicitly or remove the incompatible extension from this host.`, [...path, id, 'version']));
          continue;
        }
        try {
          const value = entry.contribution.value;
          const validator = typeof value === 'function' ? value as ExtensionSchemaValidator
            : value && typeof value === 'object' && 'validate' in value ? (value as {validate: ExtensionSchemaValidator}).validate : null;
          if (validator) issues.push(...validator(record.data, [...path, id, 'data']));
          else issues.push(createIssue('extension/validation-unavailable', `Schema ${id} has no runtime validator; provide a validate function`, [...path, id, 'data']));
        } catch {
          issues.push(createIssue('extension/validation-failed', `Validator for ${id} failed; retry after fixing the extension`, [...path, id, 'data']));
        }
      }
      return issues;
    },

    /** Core validation precedes this method. Missing extension providers retain unknown JSON. */
    validateBoard(document: BoardDocument): readonly ValidationIssue[] {
      const issues: ValidationIssue[] = [...this.validateExtensionRecords(document.extensions, ['extensions'])];
      for (const table of ['pages', 'entities', 'placements', 'connectors', 'assets'] as const) {
        for (const [index, record] of document[table].entries()) {
          issues.push(...this.validateExtensionRecords(record.extensions, [table, index, 'extensions']));
          if (table !== 'entities' || !('type' in record)) continue;
          const entry = registry.getContribution('component', record.type);
          const value = entry?.contribution.value;
          if (!value || typeof value !== 'object' || !('validate' in value)) continue;
          try { issues.push(...(value as {validate: (entity: unknown) => readonly ValidationIssue[]}).validate(record)); }
          catch { issues.push(createIssue('extension/validation-failed', `Component validator for ${record.type} failed`, [table, index, 'data'], record.id)); }
        }
      }
      return issues;
    },

    /** Dispatch a registered command contribution. Returns missing-contribution if id unknown. */
    async dispatchCommand(id: string, input: unknown): Promise<ExtensionHostDispatchResult> {
      return dispatchHandler('command', id, input);
    },

    /** Call a registered tool contribution. Returns missing-contribution if id unknown. */
    async callTool(id: string, input: unknown): Promise<ExtensionHostDispatchResult> {
      return dispatchHandler('tool', id, input);
    },

    /** Returns the execution provider for the given contribution id, or undefined. */
    getExecutionProvider(id: string): ExtensionExecutionProvider | undefined {
      const entry = registry.getContribution('execution-provider', id);
      return entry ? (entry.contribution.value as ExtensionExecutionProvider) : undefined;
    },

    dispose(): readonly unknown[] {
      disposed = true;
      return registry.dispose();
    },
  };
}

/** Presentation is adapter-specific and deliberately separate from semantic registration. */
export function createComponentRendererRegistry<Renderer>() {
  const renderers = new Map<string, Renderer>();
  const key = (adapterId: string, componentType: string) => `${adapterId}\u0000${componentType}`;
  return {
    register(adapterId: string, componentType: string, renderer: Renderer): () => void {
      if (!namespaced(adapterId) || !namespaced(componentType)) throw new TypeError('Adapter and component identifiers must be namespaced');
      const id = key(adapterId, componentType);
      if (renderers.has(id)) throw new Error(`Duplicate renderer ${adapterId} ${componentType}`);
      renderers.set(id, renderer);
      let active = true;
      return () => { if (active) { active = false; renderers.delete(id); } };
    },
    resolve(adapterId: string, componentType: string): { readonly status: 'ready'; readonly renderer: Renderer } | { readonly status: 'placeholder'; readonly label: string } {
      const id = key(adapterId, componentType);
      return renderers.has(id) ? { status: 'ready', renderer: renderers.get(id)! } : { status: 'placeholder', label: `Missing renderer: ${componentType}` };
    },
    dispose() { renderers.clear(); },
  };
}
