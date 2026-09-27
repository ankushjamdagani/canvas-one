/**
 * CompareAndResolvePanel (22F compare and resolve) — RV-11b review round.
 *
 * specs/revamp/screens/22F_compare_and_resolve.png: a full-panel merge view —
 * left list (UNRESOLVED / AUTO-MERGED / UNCHANGED), a main pane of the selected
 * record's fields (conflicting fields showing ours vs theirs with use-ours /
 * use-theirs / edit; resolved fields showing "resolved · field · side" +
 * reopen; auto-merged fields tagged "auto · side"), and a footer progress bar
 * with Next conflict / Apply and run.
 *
 * design-revalidation.md §2 overrides the mockup's single-letter shortcuts
 * ("n next · o ours · t theirs · e edit") — commands.md §1 allows only Mod+Z,
 * Mod+Shift+Z, Delete/Backspace and F2, no bare-letter global shortcuts — so
 * none are wired here; every action is a visible, labelled control.
 *
 * Domain note: persistence/studio/candidates.ts fixes "ours" = main's content
 * and "theirs" = the source branch's head content (its own comment: "Load
 * base/ours(=main head)/theirs(=source head) snapshots"). The 22F mockup's
 * illustrative labels read the opposite way round for its specific example, so
 * the ours/theirs values also show their real branch names, to stay correct
 * (D15: mockup wording is illustrative; getting this backwards would resolve
 * conflicts to the wrong side).
 */

import * as React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import type { Document, Id } from '../../domain/studio/model';
import type { EditableRecord } from '../../persistence/studio/types';
import { diffDocuments, type DiffRecordKind } from '../../domain/versioning/diff';
import type { ConflictResolution } from '../../domain/versioning/resolve';
import type { MergeConflict } from '../../domain/versioning/merge';
import { findRecordLabelAcrossDocuments } from './diffSummary';
import type { ResolvedFieldRecord } from './publishController';

const KIND_TO_COLLECTION_KEY = {
  element: 'elements',
  connection: 'connections',
  relation: 'relations',
  schema: 'schemas',
  fixture: 'fixtures',
  refinement: 'refinements',
  scenario: 'scenarios',
  view: 'views',
} satisfies Record<string, keyof Document>;

export interface CompareAndResolvePanelProps {
  readonly sourceBranchLabel: string | null;
  readonly mainBranchLabel: string | null;
  readonly conflicts: readonly Readonly<MergeConflict>[];
  readonly resolvedFields: readonly Readonly<ResolvedFieldRecord>[];
  readonly mergeInputs: { readonly base: Document; readonly ours: Document; readonly theirs: Document };
  readonly mergedDocument: Document;
  readonly eligible: boolean;
  readonly totalScenarios: number;
  readonly passingScenarios: number;
  readonly isBusy?: boolean;
  readonly errorMessage?: string | null;
  readonly onResolve: (conflictId: Id, resolution: ConflictResolution) => void | Promise<void>;
  readonly onResolveAll: (side: 'ours' | 'theirs') => void | Promise<void>;
  readonly onReopen: (field: ResolvedFieldRecord) => void | Promise<void>;
  readonly onApplyAndRun: () => void | Promise<void>;
  readonly onClose?: () => void;
  readonly className?: string;
}

type RecordKey = `${string}:${string}`;

function recordKey(recordKind: string, recordId: string): RecordKey {
  return `${recordKind}:${recordId}`;
}

function lookupRecord(doc: Document, recordKind: string, recordId: Id): EditableRecord['record'] | null {
  if (recordKind === 'document') {
    return null;
  }
  if (!isCollectionKind(recordKind)) return null;
  const collection = doc[KIND_TO_COLLECTION_KEY[recordKind]];
  return collection.find((r) => r.id === recordId) ?? null;
}

function isCollectionKind(kind: string): kind is keyof typeof KIND_TO_COLLECTION_KEY {
  return Object.hasOwn(KIND_TO_COLLECTION_KEY, kind);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Preserve the owning record and replace only an existing scalar of the same type. */
export function setAtPath<T extends object>(record: T, path: readonly (string | number)[], value: number | string): T {
  const clone = structuredClone(record);
  if (path.length === 0) throw new Error('Field editing requires a scalar field path');
  let parent: unknown = clone;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (Array.isArray(parent)) {
      parent = typeof seg === 'number' ? parent[seg] : parent.find((m: unknown) => isObject(m) && m.id === seg);
    } else if (isObject(parent) && Object.hasOwn(parent, seg)) {
      parent = parent[seg];
    } else {
      throw new Error('Conflict field path does not exist in ours');
    }
  }
  const lastSeg = path[path.length - 1];
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Field value must be finite');
  if (Array.isArray(parent) && typeof lastSeg === 'number' && typeof parent[lastSeg] === typeof value) {
    parent[lastSeg] = value;
  } else if (isObject(parent) && Object.hasOwn(parent, lastSeg) && typeof parent[lastSeg] === typeof value) {
    parent[lastSeg] = value;
  } else {
    throw new Error('Field edit must replace an existing scalar of the same type');
  }
  return clone;
}

type FieldEntry = {
  readonly path: readonly (string | number)[];
  readonly pathLabel: string;
  readonly baseValue: unknown;
  readonly mergedValue: unknown;
  readonly conflict: Readonly<MergeConflict> | null;
  readonly resolved: Readonly<ResolvedFieldRecord> | null;
  readonly autoSide: 'ours' | 'theirs' | null;
};

function recordLabels(documents: readonly Document[]): Map<string, string> {
  const labels = new Map<string, string>();
  const visit = (value: unknown, context: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${context} ${index + 1}`));
    } else if (isObject(value)) {
      const label =
        typeof value.label === 'string' ? value.label : typeof value.title === 'string' ? value.title : context;
      if (typeof value.id === 'string') labels.set(value.id, label);
      for (const [key, child] of Object.entries(value))
        if (child && typeof child === 'object') visit(child, `${label} · ${key}`);
    }
  };
  documents.forEach((doc) => visit(doc, doc.title));
  return labels;
}

/** Flattens a record to scalar leaf field paths (plain objects recursed by key,
 * arrays recursed by member id when present, else index). Used to render every
 * field of the selected record, not just the ones currently in conflict. */
function flattenLeaves(
  value: unknown,
  prefix: readonly (string | number)[] = [],
): Map<string, { readonly path: readonly (string | number)[]; readonly value: unknown }> {
  const out = new Map<string, { path: readonly (string | number)[]; value: unknown }>();
  if (value === null || typeof value !== 'object') {
    out.set(prefix.join('.'), { path: prefix, value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      const key = isObject(item) && typeof item.id === 'string' ? item.id : i;
      for (const [k, v] of flattenLeaves(item, [...prefix, key])) out.set(k, v);
    });
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    for (const [kk, vv] of flattenLeaves(v, [...prefix, k])) out.set(kk, vv);
  }
  return out;
}

function ConflictField({
  entry,
  oursBranchLabel,
  theirsBranchLabel,
  onUseOurs,
  onUseTheirs,
  onEdit,
  isBusy,
  formatValue,
}: {
  readonly entry: FieldEntry;
  readonly oursBranchLabel: string;
  readonly theirsBranchLabel: string;
  readonly onUseOurs: () => void;
  readonly onUseTheirs: () => void;
  readonly onEdit: (value: number | string) => void;
  readonly isBusy: boolean;
  readonly formatValue: (value: unknown) => string;
}): React.JSX.Element {
  const conflict = entry.conflict!;
  const oursVal = conflict.ours.present ? conflict.ours.value : undefined;
  const theirsVal = conflict.theirs.present ? conflict.theirs.value : undefined;
  const scalarKind = typeof oursVal === 'number' ? 'number' : typeof oursVal === 'string' ? 'string' : null;
  const canEdit = conflict.recordKind !== 'document' && conflict.path.length > 0 && scalarKind !== null;

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  return (
    <div
      id={`merge-conflict-${conflict.id}`}
      tabIndex={-1}
      data-testid={`field-conflict-${entry.pathLabel}`}
      className="rounded-control border border-risk-edge bg-risk-tint/40 px-3 py-2 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-risk-text">{entry.pathLabel}</span>
        {!editing && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isBusy}
              onClick={onUseOurs}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              use ours
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onUseTheirs}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              use theirs
            </button>
            {canEdit && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setDraft(String(oursVal ?? ''));
                  setEditing(true);
                }}
                className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
              >
                edit
              </button>
            )}
          </div>
        )}
      </div>
      {!editing ? (
        <div className="space-y-1 font-mono text-xs">
          <div className="flex items-center gap-2">
            <Badge variant="neutral" className="text-[10px] px-1 py-0 shrink-0">
              ours · {oursBranchLabel}
            </Badge>
            <span className="text-foreground truncate">{formatValue(oursVal)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="risk" className="text-[10px] px-1 py-0 shrink-0">
              theirs · {theirsBranchLabel}
            </Badge>
            <span className="text-foreground truncate">{formatValue(theirsVal)}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2" data-testid={`field-edit-${entry.pathLabel}`}>
          <Input
            aria-label={`Edit ${entry.pathLabel}`}
            type={scalarKind === 'number' ? 'number' : 'text'}
            step="any"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-7 text-xs"
          />
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs shrink-0"
            disabled={isBusy || (scalarKind === 'number' && (draft.trim() === '' || !Number.isFinite(Number(draft))))}
            onClick={() => {
              onEdit(scalarKind === 'number' ? Number(draft) : draft);
              setEditing(false);
            }}
          >
            Use value
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      )}
      {!canEdit && (
        <p className="text-xs text-muted-foreground">This field cannot be edited here; choose ours or theirs.</p>
      )}
    </div>
  );
}

export function CompareAndResolvePanel({
  sourceBranchLabel,
  mainBranchLabel,
  conflicts,
  resolvedFields,
  mergeInputs,
  mergedDocument,
  eligible,
  totalScenarios,
  passingScenarios,
  isBusy = false,
  errorMessage,
  onResolve,
  onResolveAll,
  onReopen,
  onApplyAndRun,
  onClose,
  className,
}: CompareAndResolvePanelProps): React.JSX.Element {
  // Domain "ours" = main, "theirs" = source branch (see header comment). Labels
  // shown beside each side identify its real branch.
  if (mainBranchLabel === null || sourceBranchLabel === null) throw new Error('Merge review requires branch labels');
  const oursBranchLabel = mainBranchLabel;
  const theirsBranchLabel = sourceBranchLabel;
  const labels = React.useMemo(
    () => recordLabels([mergeInputs.base, mergeInputs.theirs, mergeInputs.ours, mergedDocument]),
    [mergeInputs, mergedDocument],
  );
  const formatValue = (value: unknown): string => {
    if (value === undefined) return '(absent)';
    return JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'string' ? (labels.get(item) ?? item) : item,
    );
  };
  const formatPath = (path: readonly (string | number)[]) =>
    path.map((part) => (typeof part === 'string' ? (labels.get(part) ?? part) : part)).join('.') || '(record)';

  const unresolvedRecords = React.useMemo(() => {
    const map = new Map<RecordKey, { recordKind: string; recordId: Id; count: number; label: string }>();
    for (const c of conflicts) {
      const key = recordKey(c.recordKind, c.recordId);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        const label = findRecordLabelAcrossDocuments(
          [mergeInputs.ours, mergeInputs.theirs, mergeInputs.base],
          c.recordKind,
          c.recordId,
        );
        if (label === null) throw new Error('Merge conflict record has no label');
        map.set(key, { recordKind: c.recordKind, recordId: c.recordId, count: 1, label });
      }
    }
    return [...map.values()];
  }, [conflicts, mergeInputs]);

  const autoMergedRecords = React.useMemo(() => {
    const conflictedKeys = new Set(
      [...unresolvedRecords, ...resolvedFields].map((r) => recordKey(r.recordKind, r.recordId)),
    );
    const diffs = diffDocuments(mergeInputs.base, mergedDocument);
    const out: { recordKind: DiffRecordKind; recordId: Id; label: string; symbol: '+' | '~' | '-'; side: string }[] =
      [];
    for (const d of diffs) {
      const key = recordKey(d.recordKind, d.id);
      if (conflictedKeys.has(key)) continue;
      const oursRecord = lookupRecord(mergeInputs.ours, d.recordKind, d.id);
      const theirsRecord = lookupRecord(mergeInputs.theirs, d.recordKind, d.id);
      const mergedRecord = lookupRecord(mergedDocument, d.recordKind, d.id);
      const matchesOurs = JSON.stringify(mergedRecord) === JSON.stringify(oursRecord);
      const matchesTheirs = JSON.stringify(mergedRecord) === JSON.stringify(theirsRecord);
      // A one-sided change: report whichever real side it actually matches.
      // When both sides made the identical change (coalesced), it matches both;
      // report it under "theirs" (the source branch) since that is the side the
      // person is actively publishing.
      const side =
        matchesTheirs && matchesOurs
          ? 'ours + theirs'
          : matchesTheirs
            ? 'theirs'
            : matchesOurs
              ? 'ours'
              : 'ours + theirs';
      const label = findRecordLabelAcrossDocuments(
        [mergedDocument, mergeInputs.ours, mergeInputs.theirs, mergeInputs.base],
        d.recordKind,
        d.id,
      );
      if (label === null) throw new Error('Changed merge record has no label');
      out.push({
        recordKind: d.recordKind,
        recordId: d.id,
        label,
        symbol: d.change === 'added' ? '+' : d.change === 'removed' ? '-' : '~',
        side,
      });
    }
    return out;
  }, [mergeInputs, mergedDocument, unresolvedRecords, resolvedFields]);

  const changedKeys = new Set([
    ...diffDocuments(mergeInputs.base, mergedDocument).map((d) => recordKey(d.recordKind, d.id)),
    ...conflicts.map((c) => recordKey(c.recordKind, c.recordId)),
    ...resolvedFields.map((r) => recordKey(r.recordKind, r.recordId)),
  ]);
  const unchangedCount = Object.values(KIND_TO_COLLECTION_KEY).reduce(
    (count, key) =>
      count + mergedDocument[key].filter((r) => ![...changedKeys].some((k) => k.endsWith(`:${r.id}`))).length,
    0,
  );

  // Default selection: the first still-open conflict, or — once every conflict
  // on this candidate is resolved — the first resolved record, so "resolved ·
  // field · side" stays visible rather than falling back to an empty pane.
  const defaultSelection = unresolvedRecords[0]
    ? { recordKind: unresolvedRecords[0].recordKind, recordId: unresolvedRecords[0].recordId }
    : resolvedFields[0]
      ? { recordKind: resolvedFields[0].recordKind, recordId: resolvedFields[0].recordId }
      : (autoMergedRecords[0] ?? null);

  const [selected, setSelected] = React.useState<{ recordKind: string; recordId: Id } | null>(defaultSelection);
  const [filter, setFilter] = React.useState<'open' | 'all'>('all');
  const [showUnchanged, setShowUnchanged] = React.useState(false);
  const [focusedConflictId, setFocusedConflictId] = React.useState<Id | null>(null);

  React.useEffect(() => {
    if (!focusedConflictId) return;
    const field = document.getElementById(`merge-conflict-${focusedConflictId}`);
    field?.focus();
    field?.scrollIntoView({ block: 'nearest' });
  }, [focusedConflictId, selected]);

  React.useEffect(() => {
    if (!selected && defaultSelection) {
      setSelected(defaultSelection);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, defaultSelection?.recordKind, defaultSelection?.recordId]);

  const selectedRecordInfo = selected ? { label: requireLabel(selected.recordKind, selected.recordId) } : null;

  function requireLabel(kind: string, id: Id): string {
    const label = findRecordLabelAcrossDocuments(
      [mergedDocument, mergeInputs.ours, mergeInputs.theirs, mergeInputs.base],
      kind,
      id,
    );
    if (label === null) throw new Error(`Missing label for merge record ${kind}:${id}`);
    return label;
  }

  const fieldEntries: readonly FieldEntry[] = React.useMemo(() => {
    if (!selected) return [];
    const baseRecord =
      selected.recordKind === 'document'
        ? { title: mergeInputs.base.title }
        : lookupRecord(mergeInputs.base, selected.recordKind, selected.recordId);
    const mergedRecord =
      selected.recordKind === 'document'
        ? { title: mergedDocument.title }
        : lookupRecord(mergedDocument, selected.recordKind, selected.recordId);

    const baseLeaves = baseRecord ? flattenLeaves(baseRecord) : new Map();
    const mergedLeaves = mergedRecord ? flattenLeaves(mergedRecord) : new Map();
    const paths = new Set<string>([...baseLeaves.keys(), ...mergedLeaves.keys()]);

    const conflictsForRecord = conflicts.filter(
      (c) => c.recordKind === selected.recordKind && c.recordId === selected.recordId,
    );
    const resolvedForRecord = resolvedFields.filter(
      (r) => r.recordKind === selected.recordKind && r.recordId === selected.recordId,
    );

    for (const field of [...conflictsForRecord, ...resolvedForRecord]) paths.add(field.path.join('.'));

    const entries: FieldEntry[] = [];
    for (const pathKey of paths) {
      const merged = mergedLeaves.get(pathKey);
      const base = baseLeaves.get(pathKey);
      const conflict = conflictsForRecord.find((c) => c.path.join('.') === pathKey) ?? null;
      const resolved = resolvedForRecord.find((r) => r.path.join('.') === pathKey) ?? null;
      const path = conflict?.path ?? resolved?.path ?? merged?.path ?? base?.path;
      if (!path) throw new Error('Merge field has no path');
      if (
        !conflict &&
        !resolved &&
        [...conflictsForRecord, ...resolvedForRecord].some(
          (field) => field.path.length < path.length && field.path.every((segment, i) => segment === path[i]),
        )
      )
        continue;
      const mergedValue = merged?.value;
      const baseValue = base?.value;
      let autoSide: 'ours' | 'theirs' | null = null;
      if (!conflict && !resolved && JSON.stringify(mergedValue) !== JSON.stringify(baseValue)) {
        const theirsRecord = selected.recordKind === 'document' ? { title: mergeInputs.theirs.title } : lookupRecord(mergeInputs.theirs, selected.recordKind, selected.recordId);
        const theirsLeaves = theirsRecord ? flattenLeaves(theirsRecord) : new Map();
        const matchesTheirs = JSON.stringify(mergedValue) === JSON.stringify(theirsLeaves.get(pathKey)?.value);
        autoSide = matchesTheirs ? 'theirs' : 'ours';
      }
      entries.push({ path, pathLabel: formatPath(path), baseValue, mergedValue, conflict, resolved, autoSide });
    }

    entries.sort((a, b) => a.pathLabel.localeCompare(b.pathLabel));
    return entries;
  }, [selected, mergeInputs, mergedDocument, conflicts, resolvedFields, labels]);

  const conflictEntries = fieldEntries.filter((e) => e.conflict);
  const resolvedEntries = fieldEntries.filter((e) => e.resolved);
  const autoEntries = fieldEntries.filter((e) => e.autoSide);
  const unchangedEntries = fieldEntries.filter((e) => !e.conflict && !e.resolved && !e.autoSide);

  const totalConflictRecords = conflicts.length + resolvedFields.length;
  const resolvedRecordCount = resolvedFields.length;

  const handleUseOurs = (conflictId: Id) => onResolve(conflictId, { kind: 'ours' });
  const handleUseTheirs = (conflictId: Id) => onResolve(conflictId, { kind: 'theirs' });
  const handleEdit = (entry: FieldEntry, value: number | string) => {
    if (!selected || !entry.conflict) return;
    const oursRecord = lookupRecord(mergeInputs.ours, selected.recordKind, selected.recordId);
    if (!oursRecord) throw new Error('Field editing requires an owning record in ours');
    const edited = setAtPath(oursRecord, entry.conflict.path, value);
    void onResolve(entry.conflict.id, { kind: 'edited', record: edited });
  };

  const goToNextConflict = () => {
    if (conflicts.length === 0) return;
    const currentIdx = focusedConflictId ? conflicts.findIndex((c) => c.id === focusedConflictId) : conflicts.findIndex((c) => c.recordKind === selected?.recordKind && c.recordId === selected.recordId);
    const next = conflicts[(currentIdx + 1) % conflicts.length];
    setSelected({ recordKind: next.recordKind, recordId: next.recordId });
    setFocusedConflictId(next.id);
  };

  const listedRecords = filter === 'open' ? unresolvedRecords : [...unresolvedRecords, ...autoMergedRecords];

  return (
    <div
      data-testid="compare-and-resolve-panel"
      className={cn('flex flex-col h-full bg-card text-foreground', className)}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <h2 className="text-sm font-semibold text-foreground">
          Merge {theirsBranchLabel} → {oursBranchLabel}
        </h2>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-risk-text font-semibold">{conflicts.length} conflicts open</span>
          <span className="text-muted-foreground">{autoMergedRecords.length} auto</span>
          {onClose && (
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border text-xs">
        <button
          type="button"
          onClick={() => setFilter('open')}
          className={cn(
            'px-2 py-1 rounded-control font-medium',
            filter === 'open' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          conflicts {conflicts.length} open
        </button>
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={cn(
            'px-2 py-1 rounded-control font-medium',
            filter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          all {changedKeys.size}
        </button>
        {unresolvedRecords.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onResolveAll('ours')}
              className="text-primary hover:underline disabled:opacity-50"
            >
              {oursBranchLabel} everywhere
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onResolveAll('theirs')}
              className="text-primary hover:underline disabled:opacity-50"
            >
              {theirsBranchLabel} everywhere
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-56 border-r border-border overflow-y-auto shrink-0 py-2">
          {unresolvedRecords.length > 0 && (
            <div className="px-3 pb-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1 pb-1">
                Unresolved
              </p>
              {unresolvedRecords.map((r) => (
                <button
                  key={recordKey(r.recordKind, r.recordId)}
                  type="button"
                  data-testid={`unresolved-record-${r.recordId}`}
                  onClick={() => setSelected({ recordKind: r.recordKind, recordId: r.recordId })}
                  className={cn(
                    'flex items-center justify-between w-full px-2 py-1.5 rounded-control text-xs text-left',
                    selected?.recordId === r.recordId
                      ? 'bg-risk-tint text-risk-text font-medium'
                      : 'text-foreground hover:bg-sunken',
                  )}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <AlertTriangle className="size-3 text-risk-text shrink-0" />
                    <span className="truncate">{r.label}</span>
                  </span>
                  <span className="font-mono text-risk-text shrink-0">{r.count}</span>
                </button>
              ))}
            </div>
          )}
          {filter === 'all' && autoMergedRecords.length > 0 && (
            <div className="px-3 pb-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1 pb-1">
                Auto-merged · {autoMergedRecords.length}
              </p>
              {autoMergedRecords.map((r) => (
                <button
                  key={recordKey(r.recordKind, r.recordId)}
                  type="button"
                  onClick={() => setSelected({ recordKind: r.recordKind, recordId: r.recordId })}
                  className={cn(
                    'flex items-center justify-between w-full px-2 py-1.5 rounded-control text-xs text-left',
                    selected?.recordId === r.recordId ? 'bg-sunken font-medium' : 'text-foreground hover:bg-sunken',
                  )}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="font-mono text-primary shrink-0">{r.symbol}</span>
                    <span className="truncate">{r.label}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0">{r.side}</span>
                </button>
              ))}
            </div>
          )}
          <div className="px-4 text-[11px] text-muted-foreground">Unchanged · {unchangedCount}</div>
          {resolvedFields.length > 0 && (
            <div className="px-3 py-2">
              <p className="text-[10px] uppercase text-muted-foreground">Resolved</p>
              {resolvedFields.map((field) => (
                <button
                  key={`${field.recordId}:${field.path.join('.')}`}
                  type="button"
                  className="block text-xs py-1"
                  onClick={() => setSelected({ recordKind: field.recordKind, recordId: field.recordId })}
                >
                  {requireLabel(field.recordKind, field.recordId)} · {formatPath(field.path)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {!selectedRecordInfo ? (
            <p className="text-sm text-muted-foreground italic">
              {unresolvedRecords.length === 0 ? 'No conflicts remain.' : 'Select a record to review its fields.'}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                <span className="text-sm font-semibold text-foreground">{selectedRecordInfo.label}</span>
                <span>
                  base · {oursBranchLabel} · {theirsBranchLabel}
                </span>
              </div>

              {conflictEntries.map((entry) => (
                <ConflictField
                  key={entry.pathLabel}
                  entry={entry}
                  oursBranchLabel={oursBranchLabel}
                  theirsBranchLabel={theirsBranchLabel}
                  isBusy={isBusy}
                  formatValue={formatValue}
                  onUseOurs={() => handleUseOurs(entry.conflict!.id)}
                  onUseTheirs={() => handleUseTheirs(entry.conflict!.id)}
                  onEdit={(value) => handleEdit(entry, value)}
                />
              ))}

              {resolvedEntries.map((entry) => (
                <div
                  key={entry.pathLabel}
                  data-testid={`field-resolved-${entry.pathLabel}`}
                  className="flex items-center justify-between rounded-control border border-primary/30 bg-primary/10 px-3 py-2 text-xs"
                >
                  <span className="font-mono">
                    resolved · {entry.pathLabel} · {entry.resolved!.resolution}
                  </span>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void onReopen(entry.resolved!)}
                    className="text-primary disabled:opacity-50"
                  >
                    reopen
                  </button>
                </div>
              ))}

              {autoEntries.map((entry) => (
                <div
                  key={entry.pathLabel}
                  className="flex items-center justify-between px-3 py-1.5 text-xs font-mono text-muted-foreground"
                >
                  <span>
                    {entry.pathLabel}: {formatValue(entry.mergedValue)}
                  </span>
                  <span>auto · {entry.autoSide}</span>
                </div>
              ))}

              {unchangedEntries.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowUnchanged(!showUnchanged)}
                    className="text-xs text-primary hover:underline"
                  >
                    {unchangedEntries.length} unchanged {unchangedEntries.length === 1 ? 'line' : 'lines'} ·{' '}
                    {showUnchanged ? 'collapse' : 'expand'}
                  </button>
                  {showUnchanged && (
                    <div className="mt-1 space-y-1">
                      {unchangedEntries.map((entry) => (
                        <div key={entry.pathLabel} className="px-3 py-1 text-xs font-mono text-muted-foreground">
                          {entry.pathLabel}: {formatValue(entry.mergedValue)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {errorMessage && (
        <p role="alert" className="px-4 py-2 text-sm text-risk-text">
          {errorMessage}
        </p>
      )}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-32 h-1.5 rounded-full bg-sunken overflow-hidden">
            <div
              className="h-full bg-primary"
              style={{
                width: `${totalConflictRecords > 0 ? Math.round((resolvedRecordCount / totalConflictRecords) * 100) : 100}%`,
              }}
            />
          </div>
          <span data-testid="resolve-progress" className="font-mono text-muted-foreground">
            {resolvedRecordCount} of {totalConflictRecords} resolved
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={unresolvedRecords.length === 0}
            onClick={goToNextConflict}
          >
            Next conflict
            <ChevronRight className="size-3.5 ml-1" />
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={unresolvedRecords.length > 0 || isBusy}
            title={unresolvedRecords.length > 0 ? 'Resolve every conflict first' : undefined}
            onClick={() => void onApplyAndRun()}
          >
            Apply and run
          </Button>
        </div>
      </div>
      {totalScenarios > 0 && (
        <p className="px-4 pb-2 text-[11px] text-muted-foreground font-mono">
          {passingScenarios} of {totalScenarios} scenarios passing on this candidate
          {eligible ? '' : ' — run required after resolving'}
        </p>
      )}
    </div>
  );
}
