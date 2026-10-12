import type { Document, Id } from '@canvas-one/system-design/studio/model';
import type { BuildManifestVersions } from '@canvas-one/system-design/studio/manifest';
import type { Issue } from '@canvas-one/system-design/studio/validate';
import { createIssue } from '@canvas-one/system-design/studio/issue';
import type { CheckResult, RunSummary, TerminalStatus, TraceEvent } from './runner/types.js';

export type TraceChunkRecord = {
  readonly projectId: Id; readonly runId: Id; readonly index: number;
  readonly firstSequence: number; readonly events: readonly TraceEvent[];
  readonly payloads: unknown; readonly byteLength: number;
};

export const DEFAULT_BUILD_VERSIONS: BuildManifestVersions = Object.freeze({
  compilerVersion: 'studio-compiler/1',
  runnerVersions: Object.freeze([{ runnerId: 'studio-runner', version: 'studio-runner/5' }]),
});

export type RunRecord = {
  readonly projectId: Id;
  readonly id: Id;
  readonly snapshotId: string; // Hash
  readonly manifest: unknown;
  readonly fingerprint: string;
  readonly status: TerminalStatus;
  readonly provenance: 'local' | 'imported-unverified';
  readonly checks: readonly CheckResult[];
  readonly summary: RunSummary;
  readonly traceState: 'complete' | 'pruned' | 'not-saved';
  readonly createdAt: number;
  readonly completedAt: number;
};

export type TerminalRunArtifact = {
  readonly runId: Id;
  readonly fingerprint: string;
  readonly status: TerminalStatus;
  readonly checks: readonly CheckResult[];
  readonly summary: RunSummary;
};
export type SaveRunResult<Code extends string = string> =
  | { readonly status: 'applied'; readonly runId: Id; readonly run: RunRecord }
  | { readonly status: 'invalid'; readonly issues: readonly Issue[] }
  | { readonly status: 'failed'; readonly code: Code; readonly issues: readonly Issue[] };

/** Persistence capability only; no database implementation or project repository required. */
export interface RunArtifactStore<Code extends string = string> {
  saveRun(startToken: unknown, terminalResult: TerminalRunArtifact, chunks?: unknown,
    options?: { readonly projectId?: Id; readonly document?: Document } | Id): Promise<SaveRunResult<Code>>;
}

/** Hosts may replace this policy with their storage adapter's richer error classification. */
export function defaultRunSaveError(error: unknown): Extract<SaveRunResult, { status: 'failed' }> {
  const quota = error instanceof Error && error.name === 'QuotaExceededError';
  const message = error instanceof Error ? error.message : String(error);
  return { status: 'failed', code: quota ? 'quota' : 'unavailable', issues: [createIssue(
    quota ? 'too-large' : 'structural-rule',
    quota ? 'Storage quota exceeded; write rejected with no partial mutations' : `Persistence operation failed: ${message}`, [],
  )] };
}
