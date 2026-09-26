/**
 * Pure diff summary and formatting helpers for System Studio History (RV-11a).
 *
 * Implements specifications from:
 * - specs/revamp/screens/scenario_commit_gate.png (CHANGES list)
 * - specs/revamp/screens/22A_history_ladder.png (commits, branch header)
 * - specs/revamp/contracts/storage.md §2–§5
 * - specs/revamp/contracts/commands.md §3
 */

import type { Document, Element, Id } from '../../domain/studio/model';
import { diffDocuments, type RecordDiff } from '../../domain/versioning/diff';
import type { CommitRecord, PublicationRecord } from '../../persistence/studio';
import type { AheadOfVersionInfo, RecordChangeItem } from './types';

// ============================================================================
// Record label lookup
// ============================================================================

function findRecordLabel(doc: Document | null, recordKind: string, id: Id): string | null {
  if (!doc) return null;

  switch (recordKind) {
    case 'document':
      return doc.title;
    case 'element':
      return doc.elements.find((e) => e.id === id)?.label ?? null;
    case 'connection':
      return doc.connections.find((c) => c.id === id)?.label ?? null;
    case 'relation':
      return doc.relations.find((r) => r.id === id)?.label ?? null;
    case 'schema':
      return doc.schemas.find((s) => s.id === id)?.label ?? null;
    case 'fixture':
      return doc.fixtures.find((f) => f.id === id)?.id ?? null;
    case 'refinement':
      return doc.refinements.find((r) => r.id === id)?.id ?? null;
    case 'scenario':
      return doc.scenarios.find((s) => s.id === id)?.label ?? null;
    case 'view':
      return doc.views.find((v) => v.id === id)?.label ?? null;
    default:
      return null;
  }
}

// ============================================================================
// Change detail derivation
// ============================================================================

function describeElementChange(
  baseEl: Element | undefined,
  workingEl: Element | undefined,
  diff: RecordDiff,
): string {
  if (!baseEl && workingEl) {
    return 'new component';
  }
  if (baseEl && !workingEl) {
    return 'removed component';
  }
  if (baseEl && workingEl) {
    // Check for resource config changes (contract §4 ResourceConfig: flat
    // capacity/concurrency/queueLimit numeric fields, never a nested "capacity" object).
    if (baseEl.behavior.kind === 'resource' && workingEl.behavior.kind === 'resource') {
      const baseCfg = baseEl.behavior.config;
      const workCfg = workingEl.behavior.config;
      if (baseCfg.capacity !== workCfg.capacity) {
        return `capacity ${baseCfg.capacity} → ${workCfg.capacity}`;
      }
      if (baseCfg.concurrency !== workCfg.concurrency) {
        return `concurrency ${baseCfg.concurrency} → ${workCfg.concurrency}`;
      }
      if (baseCfg.queueLimit !== workCfg.queueLimit) {
        return `queue limit ${baseCfg.queueLimit} → ${workCfg.queueLimit}`;
      }
    }

    if (diff.fieldPaths.length > 0) {
      const fieldNames = diff.fieldPaths
        .map((p) => (p.length > 0 ? String(p[p.length - 1]) : ''))
        .filter((n) => n.length > 0 && n !== 'kind');
      if (fieldNames.length > 0) {
        return `${fieldNames.join(', ')} changed`;
      }
    }
    return 'modified';
  }
  return 'modified';
}

function describeChange(
  baseDoc: Document,
  workingDoc: Document,
  diff: RecordDiff,
): { label: string; detail: string } {
  // Try to find label in working document first, fallback to base document.
  // If neither document carries a label for this record, say so explicitly
  // rather than showing an empty or raw-id label to the user.
  const workingLabel = findRecordLabel(workingDoc, diff.recordKind, diff.id);
  const baseLabel = findRecordLabel(baseDoc, diff.recordKind, diff.id);
  const label = workingLabel ?? baseLabel ?? 'Unlabelled';

  if (diff.recordKind === 'document') {
    const fromTitle = baseDoc.title;
    const toTitle = workingDoc.title;
    return {
      label: 'Document Title',
      detail: fromTitle && toTitle ? `"${fromTitle}" → "${toTitle}"` : 'title changed',
    };
  }

  if (diff.recordKind === 'element') {
    const baseEl = baseDoc?.elements.find((e) => e.id === diff.id);
    const workEl = workingDoc?.elements.find((e) => e.id === diff.id);
    return {
      label,
      detail: describeElementChange(baseEl, workEl, diff),
    };
  }

  if (diff.recordKind === 'connection') {
    if (diff.change === 'added') return { label, detail: 'new connection' };
    if (diff.change === 'removed') return { label, detail: 'removed connection' };
    return { label, detail: 'modified connection' };
  }

  if (diff.recordKind === 'scenario') {
    if (diff.change === 'added') return { label, detail: 'new scenario' };
    if (diff.change === 'removed') return { label, detail: 'removed scenario' };
    return { label, detail: 'modified scenario' };
  }

  // Fallback for relation, schema, fixture, refinement, view
  if (diff.change === 'added') return { label, detail: `new ${diff.recordKind}` };
  if (diff.change === 'removed') return { label, detail: `removed ${diff.recordKind}` };
  return { label, detail: `modified ${diff.recordKind}` };
}

// ============================================================================
// Public diff summary functions
// ============================================================================

/**
 * Computes human-readable changes list between base document and working document
 * using deterministic diffDocuments.
 */
export function computeChangesList(
  baseDoc: Document | null,
  workingDoc: Document | null,
): readonly RecordChangeItem[] {
  if (!baseDoc || !workingDoc) {
    return Object.freeze([]);
  }

  const diffs = diffDocuments(baseDoc, workingDoc);
  const items: RecordChangeItem[] = diffs.map((diff) => {
    const { label, detail } = describeChange(baseDoc, workingDoc, diff);
    return {
      recordKind: diff.recordKind,
      id: diff.id,
      change: diff.change,
      label,
      detail,
    };
  });

  return Object.freeze(items);
}

/**
 * Computes "n fields changed" between parent commit document and commit document
 * strictly via diffDocuments. Returns null if parent or commit doc is missing,
 * or if no differences exist.
 */
export function computeFieldsChanged(
  parentDoc: Document | null,
  commitDoc: Document | null,
): string | null {
  if (!parentDoc || !commitDoc) {
    return null;
  }

  const diffs = diffDocuments(parentDoc, commitDoc);
  if (diffs.length === 0) {
    return null;
  }

  const totalFields = diffs.reduce((sum, d) => {
    const fieldCount = d.fieldPaths.length > 0 ? d.fieldPaths.length : 1;
    return sum + fieldCount;
  }, 0);

  return `${totalFields} field${totalFields === 1 ? '' : 's'} changed`;
}

/**
 * Computes "n ahead of <version>" strictly from real data:
 * Finds the latest publication on main whose commitId exists in the branch commits DAG.
 * Returns null if not computable (e.g. on main, no publication found in ancestry, or 0 ahead).
 */
export function computeAheadOfVersion(
  commits: readonly CommitRecord[],
  publications: readonly PublicationRecord[],
): AheadOfVersionInfo | null {
  if (commits.length === 0 || publications.length === 0) {
    return null;
  }

  // Publications ordered newest first
  const sortedPublications = [...publications].sort((a, b) => b.ordinal - a.ordinal);

  for (const pub of sortedPublications) {
    const commitIndex = commits.findIndex((c) => c.id === pub.commitId);
    if (commitIndex > 0) {
      return {
        aheadCount: commitIndex,
        versionKey: pub.versionKey,
      };
    }
  }

  return null;
}

/**
 * Computes evidence summary line strictly from real saved runs in evidenceManifest/evidence.
 * Never outputs p95, burst, or unverified claims.
 */
export function computeEvidenceSummary(commit: CommitRecord): string | null {
  if (commit.evidenceManifest && commit.evidenceManifest.entries.length > 0) {
    const count = commit.evidenceManifest.entries.length;
    return `${count} scenario${count === 1 ? '' : 's'} passed`;
  }

  if (commit.evidence && commit.evidence.length > 0) {
    const count = commit.evidence.length;
    return `${count} scenario${count === 1 ? '' : 's'} passed`;
  }

  return null;
}

// ============================================================================
// Formatting helpers
// ============================================================================

export function formatCommitTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatPublicationDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  return `${day} ${month}`;
}
