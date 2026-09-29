/**
 * Portable bundle validation for System Studio transfer (RV-16b).
 *
 * Implements specs/revamp/contracts/storage.md §1 (versions), §4 (Portable bundle),
 * §6 (limits, including the Transfer row) and run-identity.md §5 (evidence inventory).
 *
 * Pure and outside any transaction: no Dexie access, no mutation, never repairs. Given the
 * raw file bytes, returns either the validated `ProjectBundle` or a list of typed `Issue`s
 * with paths. Steps run in the exact order the task prescribes:
 *
 *   1. Byte cap (64 MiB) BEFORE decoding or parsing.
 *   2. An ITERATIVE scan of the raw JSON text for container count (<=100,000) and raw
 *      depth (<=40, root = 1), done before JSON.parse. Never recursive over untrusted input.
 *   3. Parse, then check the envelope (format/version; 7, 8 and unknown -> unsupported).
 *   4. Bundle shape: closed keys per storage.md §4 and its table rows.
 *   5. Every snapshot: validateDocument, plus its ID must equal the recomputed content hash.
 *   6. Every reference (via computePinClosure, plus snapshot-table existence this repo's
 *      verifyReferenceIntegrity also checks -- pin-closure.ts's own CONTRACT GAP comment
 *      notes it cannot see the snapshots table by itself).
 *   7. The commit DAG is acyclic, and 2-parent commits are deduplicated.
 *   8. mainBranchId and initialSnapshotId exist.
 *   9. Publications: contiguous ordinals, strictly increasing versions, versionKey/metadata.
 *  10. Evidence inventory: each commit evidence ref's run exists with that fingerprint.
 *  11. Limits (§6, Local project row) on the bundle's own record counts.
 *
 * Evidence inventory is strict (run-identity.md §5 "each commit evidence ref's run exists
 * with that scenario and fingerprint"): the referenced run must exist, its `fingerprint`
 * must equal the evidence ref's fingerprint, and its `manifest.scenario.id` must be a
 * string equal to the ref's `scenarioId` -- a missing or non-string `scenario.id` is
 * itself a reported issue, never silently skipped.
 */

import { canonicalJson } from '../../domain/studio/canonical';
import { validateDocument, type Issue, type IssueCode } from '../../domain/studio/validate';
import type { Document, Id } from '../../domain/studio/model';
import { computeSnapshotId } from './primitives';
import { validateActor } from './primitives';
import { validateSavedPart } from '../../domain/parts/validate';
import {
  computePinClosure,
  type PinClosureState,
} from '../../domain/versioning/pin-closure';
import {
  compareSemanticVersions,
  deriveVersionKey,
  validatePublicationMetadata,
} from '../../domain/versioning/publication';
import {
  PORTABLE_FORMAT,
  PORTABLE_VERSION,
  STORAGE_LIMITS,
  type BundleBranchRecord,
  type BundleCheckpointRecord,
  type BundleCommitRecord,
  type BundlePartRecord,
  type BundlePublicationRecord,
  type BundleRunRecord,
  type BundleSnapshotRecord,
  type ProjectBundle,
} from './types';

export const TRANSFER_LIMITS = {
  maxFileBytes: 64 * 1024 * 1024,
  maxContainers: 100_000,
  maxRawDepth: 40,
} as const;

function issue(
  code: IssueCode,
  message: string,
  path: readonly (string | number)[] = [],
  entityId: string | null = null,
): Issue {
  return { code, path: [...path], entityId, severity: 'error', message };
}

export type BundleValidationOk = { readonly ok: true; readonly bundle: ProjectBundle };
export type BundleValidationFailure = { readonly ok: false; readonly issues: readonly Issue[] };
export type BundleValidationResult = BundleValidationOk | BundleValidationFailure;

/**
 * Distinguishes an unsupported-version rejection (storage.md §1: "Versions 7, 8 and
 * unknown ones are rejected with a clear message") from every other validation failure,
 * so the caller can surface `failed/unsupported-version` instead of a generic `invalid`.
 */
export type BundleValidationOutcome =
  | BundleValidationOk
  | { readonly ok: false; readonly kind: 'unsupported-version'; readonly issues: readonly Issue[] }
  | { readonly ok: false; readonly kind: 'invalid'; readonly issues: readonly Issue[] };

// ----------------------------------------------------------------------------
// Step 1-2: byte cap and iterative raw-text container/depth scan.
// ----------------------------------------------------------------------------

/**
 * Iteratively scans raw JSON text for container count and max nesting depth (root = 1),
 * tracking string/escape state so braces/brackets inside string literals are ignored.
 * Never recurses; a single forward pass over the text. Stops as soon as either ceiling is
 * exceeded (an issue is returned immediately; the scan does not need to finish).
 */
function scanContainersAndDepth(
  text: string,
): { ok: true } | { ok: false; issue: Issue } {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let containers = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      containers++;
      depth++;
      if (containers > TRANSFER_LIMITS.maxContainers) {
        return {
          ok: false,
          issue: issue(
            'too-many',
            `Portable file has more than ${TRANSFER_LIMITS.maxContainers} containers`,
            [],
          ),
        };
      }
      if (depth > TRANSFER_LIMITS.maxRawDepth) {
        return {
          ok: false,
          issue: issue(
            'too-deep',
            `Portable file raw depth exceeds ${TRANSFER_LIMITS.maxRawDepth} (root = 1)`,
            [],
          ),
        };
      }
    } else if (ch === '}' || ch === ']') {
      depth--;
    }
  }

  return { ok: true };
}

// ----------------------------------------------------------------------------
// Shape helpers
// ----------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkClosedKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: readonly (string | number)[],
  issues: Issue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      issues.push(issue('unknown-property', `Unknown property '${key}'`, [...path, key]));
    }
  }
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
  issues: Issue[],
): string | null {
  const v = obj[key];
  if (typeof v !== 'string') {
    issues.push(issue('wrong-type', `${key} must be a string`, [...path, key]));
    return null;
  }
  return v;
}

function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
  issues: Issue[],
): number | null {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    issues.push(issue('wrong-type', `${key} must be a finite number`, [...path, key]));
    return null;
  }
  return v;
}

function requireArray(
  obj: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
  issues: Issue[],
): unknown[] | null {
  const v = obj[key];
  if (!Array.isArray(v)) {
    issues.push(issue('wrong-type', `${key} must be an array`, [...path, key]));
    return null;
  }
  return v;
}

const EVIDENCE_REF_KEYS = ['scenarioId', 'fingerprint', 'runId'] as const;

function checkEvidenceRefs(
  value: unknown,
  path: readonly (string | number)[],
  issues: Issue[],
): { scenarioId: string; fingerprint: string; runId: string }[] {
  const out: { scenarioId: string; fingerprint: string; runId: string }[] = [];
  if (!Array.isArray(value)) {
    issues.push(issue('wrong-type', 'evidence must be an array', path));
    return out;
  }
  value.forEach((entry, i) => {
    const p = [...path, i];
    if (!isPlainObject(entry)) {
      issues.push(issue('wrong-type', 'evidence entry must be an object', p));
      return;
    }
    checkClosedKeys(entry, EVIDENCE_REF_KEYS, p, issues);
    const scenarioId = requireString(entry, 'scenarioId', p, issues);
    const fingerprint = requireString(entry, 'fingerprint', p, issues);
    const runId = requireString(entry, 'runId', p, issues);
    if (scenarioId !== null && fingerprint !== null && runId !== null) {
      out.push({ scenarioId, fingerprint, runId });
    }
  });
  return out;
}

const BRANCH_KEYS = [
  'id',
  'label',
  'state',
  'headCommitId',
  'workingSnapshotId',
  'workingRevision',
  'createdAt',
] as const;

const SNAPSHOT_KEYS = ['id', 'document'] as const;

const COMMIT_KEYS = [
  'id',
  'snapshotId',
  'parentIds',
  'evidence',
  'evidenceManifest',
  'actor',
  'createdAt',
  'message',
] as const;

const PUBLICATION_KEYS = [
  'id',
  'commitId',
  'sourceBranchId',
  'previousMainHeadId',
  'ordinal',
  'actor',
  'createdAt',
  'metadata',
  'versionKey',
] as const;

const CHECKPOINT_KEYS = ['id', 'snapshotId', 'sourceBranchId', 'label', 'actor', 'createdAt'] as const;

const RUN_KEYS = [
  'id',
  'snapshotId',
  'manifest',
  'fingerprint',
  'status',
  'provenance',
  'checks',
  'summary',
  'traceState',
  'createdAt',
  'completedAt',
] as const;

const PART_KEYS = ['id', 'revision', 'label', 'description', 'content', 'createdAt'] as const;

const BUNDLE_KEYS = [
  'id',
  'title',
  'createdAt',
  'updatedAt',
  'mainBranchId',
  'initialSnapshotId',
  'branches',
  'snapshots',
  'commits',
  'publications',
  'checkpoints',
  'runs',
  'parts',
] as const;

/**
 * Validates the portable file's raw bytes against every step in this module's doc
 * comment, in order. Never repairs; every finding is a typed `Issue` with a path.
 */
export async function validatePortableBundle(bytes: Uint8Array): Promise<BundleValidationOutcome> {
  const issues: Issue[] = [];

  // Step 1: byte cap BEFORE decoding or parsing.
  if (bytes.byteLength > TRANSFER_LIMITS.maxFileBytes) {
    return {
      ok: false,
      kind: 'invalid',
      issues: [
        issue(
          'too-large',
          `Portable file is ${bytes.byteLength} bytes, exceeding the ${TRANSFER_LIMITS.maxFileBytes}-byte (64 MiB) transfer cap`,
          [],
        ),
      ],
    };
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      kind: 'invalid',
      issues: [issue('wrong-type', 'Portable file is not valid UTF-8', [])],
    };
  }

  // Step 2: iterative raw-text container/depth scan, BEFORE JSON.parse.
  const scan = scanContainersAndDepth(text);
  if (!scan.ok) {
    return { ok: false, kind: 'invalid', issues: [scan.issue] };
  }

  // Step 3: parse, then envelope check.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, kind: 'invalid', issues: [issue('wrong-type', 'Portable file is not valid JSON', [])] };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, kind: 'invalid', issues: [issue('wrong-type', 'Portable file must be a JSON object', [])] };
  }

  const format = parsed.format;
  const version = parsed.version;
  if (format !== PORTABLE_FORMAT) {
    return {
      ok: false,
      kind: 'unsupported-version',
      issues: [
        issue(
          'invalid-literal',
          typeof format === 'string'
            ? `Unsupported portable format '${format}'`
            : "This file isn't a System Studio project export.",
          ['format'],
        ),
      ],
    };
  }
  if (version === 7 || version === 8 || version !== PORTABLE_VERSION) {
    return {
      ok: false,
      kind: 'unsupported-version',
      issues: [
        issue(
          'invalid-literal',
          `Unsupported portable file version '${String(version)}'; only version ${PORTABLE_VERSION} is supported`,
          ['version'],
        ),
      ],
    };
  }

  checkClosedKeys(parsed, ['format', 'version', 'project'], [], issues);

  if (!isPlainObject(parsed.project)) {
    return {
      ok: false,
      kind: 'invalid',
      issues: [...issues, issue('wrong-type', 'project must be an object', ['project'])],
    };
  }
  const rawBundle = parsed.project;

  // Step 4: bundle shape / closed keys.
  checkClosedKeys(rawBundle, BUNDLE_KEYS, ['project'], issues);
  const id = requireString(rawBundle, 'id', ['project'], issues);
  const title = requireString(rawBundle, 'title', ['project'], issues);
  const createdAt = requireNumber(rawBundle, 'createdAt', ['project'], issues);
  const updatedAt = requireNumber(rawBundle, 'updatedAt', ['project'], issues);
  const mainBranchId = requireString(rawBundle, 'mainBranchId', ['project'], issues);
  const initialSnapshotId = requireString(rawBundle, 'initialSnapshotId', ['project'], issues);
  const rawBranches = requireArray(rawBundle, 'branches', ['project'], issues) ?? [];
  const rawSnapshots = requireArray(rawBundle, 'snapshots', ['project'], issues) ?? [];
  const rawCommits = requireArray(rawBundle, 'commits', ['project'], issues) ?? [];
  const rawPublications = requireArray(rawBundle, 'publications', ['project'], issues) ?? [];
  const rawCheckpoints = requireArray(rawBundle, 'checkpoints', ['project'], issues) ?? [];
  const rawRuns = requireArray(rawBundle, 'runs', ['project'], issues) ?? [];
  const rawParts = requireArray(rawBundle, 'parts', ['project'], issues) ?? [];

  if (issues.length > 0) {
    return { ok: false, kind: 'invalid', issues };
  }

  // §6 Local project count limits, checked on the bundle's own record counts.
  if (rawBranches.length > STORAGE_LIMITS.maxBranchesPerProject) {
    issues.push(issue('too-many', 'branches exceed the 100-branch project limit', ['project', 'branches']));
  }
  if (rawCommits.length > STORAGE_LIMITS.maxCommitsPerProject) {
    issues.push(issue('too-many', 'commits exceed the 1,000-commit project limit', ['project', 'commits']));
  }
  if (rawCheckpoints.length > STORAGE_LIMITS.maxCheckpointsPerProject) {
    issues.push(issue('too-many', 'checkpoints exceed the 100-checkpoint project limit', ['project', 'checkpoints']));
  }
  if (rawRuns.length > STORAGE_LIMITS.maxRunSummariesPerProject) {
    issues.push(issue('too-many', 'runs exceed the 200-run-summary project limit', ['project', 'runs']));
  }
  if (rawParts.length > STORAGE_LIMITS.maxPartRevisionsPerProject) {
    issues.push(issue('too-many', 'parts exceed the 100-part-revision project limit', ['project', 'parts']));
  }

  const branches: BundleBranchRecord[] = [];
  rawBranches.forEach((raw, i) => {
    const p = ['project', 'branches', i];
    if (!isPlainObject(raw)) {
      issues.push(issue('wrong-type', 'branch must be an object', p));
      return;
    }
    checkClosedKeys(raw, BRANCH_KEYS, p, issues);
    const bid = requireString(raw, 'id', p, issues);
    const label = requireString(raw, 'label', p, issues);
    const state = raw.state;
    if (state !== 'open' && state !== 'closed') {
      issues.push(issue('invalid-literal', "branch.state must be 'open' or 'closed'", [...p, 'state']));
    }
    const headCommitId = raw.headCommitId;
    if (headCommitId !== null && typeof headCommitId !== 'string') {
      issues.push(issue('wrong-type', 'branch.headCommitId must be a string or null', [...p, 'headCommitId']));
    }
    const workingSnapshotId = requireString(raw, 'workingSnapshotId', p, issues);
    const workingRevision = requireNumber(raw, 'workingRevision', p, issues);
    const createdAtB = requireNumber(raw, 'createdAt', p, issues);
    if (
      bid !== null &&
      label !== null &&
      (state === 'open' || state === 'closed') &&
      workingSnapshotId !== null &&
      workingRevision !== null &&
      createdAtB !== null
    ) {
      branches.push({
        id: bid,
        label,
        state,
        headCommitId: (headCommitId as string | null) ?? null,
        workingSnapshotId,
        workingRevision,
        createdAt: createdAtB,
      });
    }
  });

  const snapshots: BundleSnapshotRecord[] = [];
  const snapshotDocs = new Map<string, Document>();
  rawSnapshots.forEach((raw, i) => {
    const p = ['project', 'snapshots', i];
    if (!isPlainObject(raw)) {
      issues.push(issue('wrong-type', 'snapshot must be an object', p));
      return;
    }
    checkClosedKeys(raw, SNAPSHOT_KEYS, p, issues);
    const sid = requireString(raw, 'id', p, issues);
    const docResult = validateDocument(raw.document);
    if (!docResult.ok) {
      issues.push(...docResult.issues.map((iss) => ({ ...iss, path: [...p, 'document', ...iss.path] })));
      return;
    }
    if (sid !== null) {
      snapshots.push({ id: sid, document: docResult.document });
      snapshotDocs.set(sid, docResult.document);
    }
  });

  const commits: BundleCommitRecord[] = [];
  rawCommits.forEach((raw, i) => {
    const p = ['project', 'commits', i];
    if (!isPlainObject(raw)) {
      issues.push(issue('wrong-type', 'commit must be an object', p));
      return;
    }
    checkClosedKeys(raw, COMMIT_KEYS, p, issues);
    const cid = requireString(raw, 'id', p, issues);
    const snapshotId = requireString(raw, 'snapshotId', p, issues);
    const parentIdsRaw = requireArray(raw, 'parentIds', p, issues) ?? [];
    const parentIds: string[] = [];
    parentIdsRaw.forEach((pid, j) => {
      if (typeof pid !== 'string') {
        issues.push(issue('wrong-type', 'parentIds entries must be strings', [...p, 'parentIds', j]));
      } else {
        parentIds.push(pid);
      }
    });
    if (parentIds.length > 2) {
      issues.push(issue('too-many', 'a commit may have at most 2 parents', [...p, 'parentIds']));
    }
    if (parentIds.length === 2 && parentIds[0] === parentIds[1]) {
      issues.push(
        issue(
          'structural-rule',
          'identical merge parents must be deduplicated to a single-parent commit',
          [...p, 'parentIds'],
        ),
      );
    }
    const evidence = checkEvidenceRefs(raw.evidence, [...p, 'evidence'], issues);
    if (raw.evidenceManifest !== undefined && !isPlainObject(raw.evidenceManifest)) {
      issues.push(issue('wrong-type', 'evidenceManifest must be an object when present', [...p, 'evidenceManifest']));
    }
    const actorIssues = validateActor(raw.actor);
    if (actorIssues) {
      issues.push(...actorIssues.map((iss) => ({ ...iss, path: [...p, ...iss.path] })));
    }
    const createdAtC = requireNumber(raw, 'createdAt', p, issues);
    const message = requireString(raw, 'message', p, issues);
    if (
      cid !== null &&
      snapshotId !== null &&
      !actorIssues &&
      createdAtC !== null &&
      message !== null
    ) {
      commits.push({
        id: cid,
        snapshotId,
        parentIds,
        evidence,
        ...(raw.evidenceManifest !== undefined ? { evidenceManifest: raw.evidenceManifest as any } : {}),
        actor: raw.actor as any,
        createdAt: createdAtC,
        message,
      });
    }
  });

  const publications: BundlePublicationRecord[] = [];
  rawPublications.forEach((raw, i) => {
    const p = ['project', 'publications', i];
    if (!isPlainObject(raw)) {
      issues.push(issue('wrong-type', 'publication must be an object', p));
      return;
    }
    checkClosedKeys(raw, PUBLICATION_KEYS, p, issues);
    const pid = requireString(raw, 'id', p, issues);
    const commitId = requireString(raw, 'commitId', p, issues);
    const sourceBranchId = requireString(raw, 'sourceBranchId', p, issues);
    const previousMainHeadId = raw.previousMainHeadId;
    if (previousMainHeadId !== null && typeof previousMainHeadId !== 'string') {
      issues.push(issue('wrong-type', 'previousMainHeadId must be a string or null', [...p, 'previousMainHeadId']));
    }
    const ordinal = requireNumber(raw, 'ordinal', p, issues);
    const actorIssues = validateActor(raw.actor);
    if (actorIssues) {
      issues.push(...actorIssues.map((iss) => ({ ...iss, path: [...p, ...iss.path] })));
    }
    const createdAtP = requireNumber(raw, 'createdAt', p, issues);
    const metadataIssues = validatePublicationMetadata(raw.metadata);
    if (metadataIssues.length > 0) {
      issues.push(...metadataIssues.map((iss) => ({ ...iss, path: [...p, ...iss.path] })));
    }
    const versionKey = requireString(raw, 'versionKey', p, issues);
    if (
      pid !== null &&
      commitId !== null &&
      sourceBranchId !== null &&
      ordinal !== null &&
      !actorIssues &&
      createdAtP !== null &&
      metadataIssues.length === 0 &&
      versionKey !== null
    ) {
      const metadata = raw.metadata as any;
      const derivedKey = deriveVersionKey(metadata.version);
      if (derivedKey !== versionKey) {
        issues.push(
          issue(
            'structural-rule',
            `versionKey '${versionKey}' does not match metadata.version ('${derivedKey}')`,
            [...p, 'versionKey'],
          ),
        );
      } else {
        publications.push({
          id: pid,
          commitId,
          sourceBranchId,
          previousMainHeadId: (previousMainHeadId as string | null) ?? null,
          ordinal,
          actor: raw.actor as any,
          createdAt: createdAtP,
          metadata,
          versionKey,
        });
      }
    }
  });

  const checkpoints: BundleCheckpointRecord[] = [];
  rawCheckpoints.forEach((raw, i) => {
    const p = ['project', 'checkpoints', i];
    if (!isPlainObject(raw)) {
      issues.push(issue('wrong-type', 'checkpoint must be an object', p));
      return;
    }
    checkClosedKeys(raw, CHECKPOINT_KEYS, p, issues);
    const cid = requireString(raw, 'id', p, issues);
    const snapshotId = requireString(raw, 'snapshotId', p, issues);
    const sourceBranchId = requireString(raw, 'sourceBranchId', p, issues);
    const label = requireString(raw, 'label', p, issues);
    const actorIssues = validateActor(raw.actor);
    if (actorIssues) {
      issues.push(...actorIssues.map((iss) => ({ ...iss, path: [...p, ...iss.path] })));
    }
    const createdAtCp = requireNumber(raw, 'createdAt', p, issues);
    if (
      cid !== null &&
      snapshotId !== null &&
      sourceBranchId !== null &&
      label !== null &&
      !actorIssues &&
      createdAtCp !== null
    ) {
      checkpoints.push({
        id: cid,
        snapshotId,
        sourceBranchId,
        label,
        actor: raw.actor as any,
        createdAt: createdAtCp,
      });
    }
  });

  const runs: BundleRunRecord[] = [];
  rawRuns.forEach((raw, i) => {
    const p = ['project', 'runs', i];
    if (!isPlainObject(raw)) {
      issues.push(issue('wrong-type', 'run must be an object', p));
      return;
    }
    checkClosedKeys(raw, RUN_KEYS, p, issues);
    const rid = requireString(raw, 'id', p, issues);
    const snapshotId = requireString(raw, 'snapshotId', p, issues);
    const fingerprint = requireString(raw, 'fingerprint', p, issues);
    const status = requireString(raw, 'status', p, issues);
    const provenance = raw.provenance;
    if (provenance !== 'local' && provenance !== 'imported-unverified') {
      issues.push(issue('invalid-literal', "provenance must be 'local' or 'imported-unverified'", [...p, 'provenance']));
    }
    if (!Array.isArray(raw.checks)) {
      issues.push(issue('wrong-type', 'checks must be an array', [...p, 'checks']));
    }
    if (!isPlainObject(raw.summary)) {
      issues.push(issue('wrong-type', 'summary must be an object', [...p, 'summary']));
    }
    const traceState = raw.traceState;
    if (traceState !== 'complete' && traceState !== 'pruned' && traceState !== 'not-saved') {
      issues.push(issue('invalid-literal', "traceState must be 'complete', 'pruned' or 'not-saved'", [...p, 'traceState']));
    }
    const createdAtR = requireNumber(raw, 'createdAt', p, issues);
    const completedAt = requireNumber(raw, 'completedAt', p, issues);
    if (
      rid !== null &&
      snapshotId !== null &&
      fingerprint !== null &&
      status !== null &&
      (provenance === 'local' || provenance === 'imported-unverified') &&
      Array.isArray(raw.checks) &&
      isPlainObject(raw.summary) &&
      (traceState === 'complete' || traceState === 'pruned' || traceState === 'not-saved') &&
      createdAtR !== null &&
      completedAt !== null
    ) {
      runs.push({
        id: rid,
        snapshotId,
        manifest: raw.manifest,
        fingerprint,
        status: status as any,
        provenance,
        checks: raw.checks as any,
        summary: raw.summary as any,
        traceState,
        createdAt: createdAtR,
        completedAt,
      });
    }
  });

  const parts: BundlePartRecord[] = [];
  const partRevisionKeys = new Set<string>();
  rawParts.forEach((raw, i) => {
    const p = ['project', 'parts', i];
    if (!isPlainObject(raw)) {
      issues.push(issue('wrong-type', 'part must be an object', p));
      return;
    }
    checkClosedKeys(raw, PART_KEYS, p, issues);
    const pid = requireString(raw, 'id', p, issues);
    const revision = requireNumber(raw, 'revision', p, issues);
    const label = requireString(raw, 'label', p, issues);
    const description = requireString(raw, 'description', p, issues);
    const createdAtPart = requireNumber(raw, 'createdAt', p, issues);
    if (pid !== null && revision !== null && label !== null && description !== null && createdAtPart !== null) {
      const key = `${pid}:${revision}`;
      if (partRevisionKeys.has(key)) issues.push(issue('duplicate-id', 'Duplicate part revision.', p));
      partRevisionKeys.add(key);
      const validated = validateSavedPart({ id: pid, revision, label, description, content: raw.content });
      if (!validated.ok) issues.push(...validated.issues.map((entry) => ({ ...entry, path: [...p, ...entry.path] })));
      else parts.push({ ...validated.value, createdAt: createdAtPart });
    }
  });

  if (issues.length > 0) {
    return { ok: false, kind: 'invalid', issues };
  }

  // Step 5: every snapshot's ID must equal its recomputed content hash.
  for (const snapshot of snapshots) {
    let recomputed: string;
    try {
      recomputed = await computeSnapshotId(snapshot.document);
    } catch {
      issues.push(issue('structural-rule', `snapshot '${snapshot.id}' failed to canonicalize`, ['project', 'snapshots'], snapshot.id));
      continue;
    }
    if (recomputed !== snapshot.id) {
      issues.push(
        issue(
          'structural-rule',
          `snapshot id '${snapshot.id}' does not match its recomputed content hash '${recomputed}'`,
          ['project', 'snapshots'],
          snapshot.id,
        ),
      );
    }
  }

  // Step 6: reference checks. Snapshot-table existence first (pin-closure.ts cannot see
  // the snapshots array by itself -- see its own CONTRACT GAP comment).
  const snapshotIds = new Set(snapshots.map((s) => s.id));
  if (initialSnapshotId !== null && !snapshotIds.has(initialSnapshotId)) {
    issues.push(issue('dangling-reference', `initialSnapshotId '${initialSnapshotId}' has no matching snapshot`, ['project', 'initialSnapshotId'], initialSnapshotId));
  }
  for (const branch of branches) {
    if (!snapshotIds.has(branch.workingSnapshotId)) {
      issues.push(
        issue(
          'dangling-reference',
          `branch '${branch.id}' workingSnapshotId '${branch.workingSnapshotId}' has no matching snapshot`,
          ['project', 'branches'],
          branch.id,
        ),
      );
    }
  }
  for (const commit of commits) {
    if (!snapshotIds.has(commit.snapshotId)) {
      issues.push(
        issue('dangling-reference', `commit '${commit.id}' snapshotId '${commit.snapshotId}' has no matching snapshot`, ['project', 'commits'], commit.id),
      );
    }
  }
  for (const checkpoint of checkpoints) {
    if (!snapshotIds.has(checkpoint.snapshotId)) {
      issues.push(
        issue('dangling-reference', `checkpoint '${checkpoint.id}' snapshotId '${checkpoint.snapshotId}' has no matching snapshot`, ['project', 'checkpoints'], checkpoint.id),
      );
    }
  }
  for (const run of runs) {
    if (!snapshotIds.has(run.snapshotId)) {
      issues.push(
        issue('dangling-reference', `run '${run.id}' snapshotId '${run.snapshotId}' has no matching snapshot`, ['project', 'runs'], run.id),
      );
    }
  }

  // Branch heads, commit parents, publication commits, commit evidence runs (dangling only
  // -- computePinClosure is the single shared authority for this walk).
  const closureState: PinClosureState = {
    project: { initialSnapshotId: initialSnapshotId ?? '', mainBranchId: mainBranchId ?? '' },
    branches: branches.map((b) => ({
      id: b.id,
      state: b.state,
      headCommitId: b.headCommitId,
      workingSnapshotId: b.workingSnapshotId,
    })),
    commits: commits.map((c) => ({
      id: c.id,
      snapshotId: c.snapshotId,
      parentIds: c.parentIds,
      evidence: c.evidence,
    })),
    publications: publications.map((p) => ({ id: p.id, commitId: p.commitId })),
    checkpoints: checkpoints.map((cp) => ({ id: cp.id, snapshotId: cp.snapshotId })),
    runs: runs.map((r) => ({ id: r.id, snapshotId: r.snapshotId })),
  };
  const closure = computePinClosure(closureState);
  for (const dangling of closure.dangling) {
    issues.push(
      issue(
        'dangling-reference',
        `dangling ${dangling.kind} reference '${dangling.id}' from ${dangling.referencedBy.kind} '${dangling.referencedBy.id}'`,
        ['project'],
        dangling.id,
      ),
    );
  }

  // Step 7: commit DAG acyclic (iterative DFS with a color map; never recursive).
  const commitById = new Map(commits.map((c) => [c.id, c]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const commit of commits) {
    if (color.get(commit.id) === BLACK) continue;
    const stack: { id: string; parentIndex: number }[] = [{ id: commit.id, parentIndex: 0 }];
    color.set(commit.id, GRAY);
    let cyclic = false;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const current = commitById.get(frame.id);
      if (!current || frame.parentIndex >= current.parentIds.length) {
        color.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      const parentId = current.parentIds[frame.parentIndex];
      frame.parentIndex++;
      const parentColor = color.get(parentId);
      if (parentColor === GRAY) {
        cyclic = true;
        break;
      }
      if (parentColor === undefined && commitById.has(parentId)) {
        color.set(parentId, GRAY);
        stack.push({ id: parentId, parentIndex: 0 });
      }
    }
    if (cyclic) {
      issues.push(issue('structural-rule', 'commit ancestry contains a cycle', ['project', 'commits'], commit.id));
      break;
    }
  }

  // Step 8: mainBranchId and initialSnapshotId exist.
  const branchIds = new Set(branches.map((b) => b.id));
  if (mainBranchId !== null && !branchIds.has(mainBranchId)) {
    issues.push(issue('dangling-reference', `mainBranchId '${mainBranchId}' has no matching branch`, ['project', 'mainBranchId'], mainBranchId));
  }

  // Step 9: publications ordinals/versions.
  const sortedPubs = [...publications].sort((a, b) => a.ordinal - b.ordinal);
  sortedPubs.forEach((pub, i) => {
    const expectedOrdinal = i + 1;
    if (pub.ordinal !== expectedOrdinal) {
      issues.push(
        issue(
          'structural-rule',
          `publication ordinals must be 1..n contiguous; expected ${expectedOrdinal} at position ${i}, got ${pub.ordinal}`,
          ['project', 'publications'],
          pub.id,
        ),
      );
    }
    if (i > 0) {
      const prev = sortedPubs[i - 1];
      if (compareSemanticVersions(pub.metadata.version, prev.metadata.version) <= 0) {
        issues.push(
          issue(
            'structural-rule',
            `publication '${pub.id}' version must strictly increase over the previous ordinal`,
            ['project', 'publications'],
            pub.id,
          ),
        );
      }
    }
  });

  // Step 10: evidence inventory -- run-identity.md §5: "each commit evidence ref's run
  // exists with that scenario and fingerprint." Strict: a cited run's manifest must carry
  // a string `scenario.id` and it must equal the evidence ref's scenarioId; a missing or
  // non-string manifest scenario id is itself an issue, not silently skipped.
  const runById = new Map(runs.map((r) => [r.id, r]));
  for (const commit of commits) {
    for (const ref of commit.evidence) {
      const run = runById.get(ref.runId);
      if (!run) {
        // Already reported as a dangling 'run' reference above via computePinClosure.
        continue;
      }
      if (run.fingerprint !== ref.fingerprint) {
        issues.push(
          issue(
            'structural-rule',
            `evidence run '${ref.runId}' fingerprint '${run.fingerprint}' does not match commit evidence fingerprint '${ref.fingerprint}'`,
            ['project', 'commits'],
            commit.id,
          ),
        );
      }
      const manifestScenarioId = (run.manifest as { scenario?: { id?: unknown } } | null | undefined)?.scenario
        ?.id;
      if (typeof manifestScenarioId !== 'string') {
        issues.push(
          issue(
            'missing-property',
            `evidence run '${ref.runId}' manifest is missing a string scenario.id`,
            ['project', 'runs'],
            ref.runId,
          ),
        );
      } else if (manifestScenarioId !== ref.scenarioId) {
        issues.push(
          issue(
            'structural-rule',
            `evidence run '${ref.runId}' manifest scenario '${manifestScenarioId}' does not match commit evidence scenarioId '${ref.scenarioId}'`,
            ['project', 'commits'],
            commit.id,
          ),
        );
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, kind: 'invalid', issues };
  }

  const bundle: ProjectBundle = {
    id: id as Id,
    title: title as string,
    createdAt: createdAt as number,
    updatedAt: updatedAt as number,
    mainBranchId: mainBranchId as Id,
    initialSnapshotId: initialSnapshotId as string,
    branches,
    snapshots,
    commits,
    publications,
    checkpoints,
    runs,
    parts,
  };

  return { ok: true, bundle };
}
