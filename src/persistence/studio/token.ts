/**
 * Run start token for System Studio runner and persistence (RV-08a).
 *
 * Implements specs/revamp/contracts/storage.md §5:
 * "The run start token is minted by the local runner controller and bound to the manifest,
 *  snapshot and run ID. Portable data can't mint one."
 *
 * It is not constructible from portable data: validated via an unforgeable in-memory
 * module-private registry (WeakMap of issued tokens), never a string format.
 */

import type { Document, Id } from '../../domain/studio/model';

export type MintRunStartTokenParams = {
  readonly projectId: Id;
  readonly runId: Id;
  readonly snapshotId: string;
  readonly manifest: unknown;
  readonly fingerprint: string;
  readonly document?: Document;
};

export type RunStartToken = {
  readonly projectId: Id;
  readonly runId: Id;
  readonly snapshotId: string;
  readonly fingerprint: string;
  readonly manifest: unknown;
  readonly document?: Document;
};

export type TokenBinding = {
  readonly projectId: Id;
  readonly runId: Id;
  readonly snapshotId: string;
  readonly fingerprint: string;
  readonly manifest: unknown;
  readonly document?: Document;
  readonly createdAt: number;
};

/**
 * Recursively deep-freezes an object and all nested object properties.
 */
function deepFreeze<T>(obj: T, seen = new WeakSet<object>()): T {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj;
  }
  if (seen.has(obj as object)) {
    return obj;
  }
  seen.add(obj as object);
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as any)[key];
    if (val !== null && typeof val === 'object') {
      deepFreeze(val, seen);
    }
  }
  return obj;
}

/**
 * Module-private WeakMap registry.
 * Because the WeakMap reference is private to this module and only accepts object keys,
 * an object constructed outside this module (e.g. from JSON deserialization) will never
 * have an entry in this registry.
 */
const tokenRegistry = new WeakMap<object, TokenBinding>();

/**
 * Mints an unforgeable, deep-frozen RunStartToken bound to project ID, run ID,
 * snapshot ID, manifest, and fingerprint.
 */
export function mintRunStartToken(params: MintRunStartTokenParams): RunStartToken {
  if (!params.projectId) {
    throw new Error('projectId is required to mint a run start token');
  }

  const binding: TokenBinding = Object.freeze({
    projectId: params.projectId,
    runId: params.runId,
    snapshotId: params.snapshotId,
    fingerprint: params.fingerprint,
    manifest: params.manifest,
    document: params.document,
    createdAt: Date.now(),
  });

  const token: RunStartToken = {
    projectId: params.projectId,
    runId: params.runId,
    snapshotId: params.snapshotId,
    fingerprint: params.fingerprint,
    manifest: params.manifest,
    document: params.document,
  };

  deepFreeze(token);
  tokenRegistry.set(token, binding);
  return token;
}

/**
 * Validates a start token against the private registry.
 * Returns the bound TokenBinding if valid and issued by mintRunStartToken, or null if forged or invalid.
 */
export function validateRunStartToken(token: unknown): TokenBinding | null {
  if (!token || typeof token !== 'object') {
    return null;
  }
  const binding = tokenRegistry.get(token as object);
  return binding ?? null;
}

