/**
 * Scenario draft lifecycle: pure logic (RV-05c).
 *
 * Implements specs/revamp/contracts/commands.md "Scenarios (D41)":
 * - scenario.new / scenario.duplicate: "Opens the scenario editor on an unsaved draft;
 *   nothing is stored until Apply, which inserts the scenario as one model.apply-records
 *   command and one undo. Cancel stores nothing."
 * - "Empty drafts invent nothing": no workloads/inputs/faults/boundaries/assertions;
 *   scope = every element in the document at draft time; the only prefilled values are
 *   the contracted budget defaults, completion:{kind:'quiescent'} for step-by-step, and
 *   a seed drawn at random when the draft opens (shown and editable).
 * - scenario.delete: "One model.apply-records remove; one undo."
 * - §6 Draft lifecycle: open/change/validate/apply/cancel; "Apply parses, validates the
 *   candidate and revision, persists one compound command, clears dirty state and adds
 *   one undo entry"; "Stale ... never silently rebases"; "If the target is deleted
 *   elsewhere, the draft is marked stale/missing."
 *
 * See types.ts for why this uses a typed-patch bridge instead of the inspector's
 * raw-string FieldSpec bridge.
 */

import type { Document, Id, Scenario, ScenarioMode, CompletionPolicy } from '../../domain/studio/model';
import { validateDocument } from '../../domain/studio/validate';
import { checkReadiness } from '../../domain/studio/readiness';
import type { RecordChange, AuthoredResult } from '../../persistence/studio/types';
import { DEFAULT_SCENARIO_BUDGETS, drawSeed } from './budgets';
import { remapScenarioForCopy } from './idRemap';
import {
  SCENARIO_SECTIONS,
  type MintId,
  type RandomSource,
  type ScenarioDraftHandle,
  type ScenarioDraftSession,
  type ScenarioDraftTarget,
  type ScenarioIssue,
  type ScenarioSection,
} from './types';

// ============================================================================
// Empty draft construction ("Empty drafts invent nothing")
// ============================================================================

/** commands.md §4: "completion:{kind:'quiescent'} for step-by-step (the only legal value)". */
function defaultCompletionForMode(mode: ScenarioMode): CompletionPolicy {
  if (mode === 'logical') {
    return { kind: 'quiescent' };
  }
  // Timed: model-and-runner.md §6 lists horizon and drain as the two timed policies;
  // horizon is the simpler one-field policy and the one shown in scenario_traffic_editor.png
  // ("Run settings ... horizon or drain"), so it is the starting selection. horizonMs is
  // chosen at the low end of the contracted 1-300s range (storage.md §6) rather than
  // invented -- 30s is a plain round default, editable immediately in Run settings.
  return { kind: 'horizon', horizonMs: 30000 };
}

function scopeElementIdsAtDraftOpen(document: Document): readonly Id[] {
  return document.elements.map((e) => e.id);
}

/**
 * commands.md §4/"Empty drafts invent nothing": builds a brand-new, unsaved Scenario
 * with no workloads/inputs/faults/boundaries/assertions, scope = every element in the
 * document right now, contracted budget defaults, mode-correct completion default, and
 * a freshly drawn seed. `revision: 0` -- a never-yet-persisted record; see
 * idRemap.ts's remapScenarioForCopy for the same choice on a copy.
 */
export function buildEmptyScenario(params: {
  readonly mintId: MintId;
  readonly randomSource: RandomSource;
  readonly mode: ScenarioMode;
  readonly label: string;
  readonly document: Document;
}): Scenario {
  const { mintId, randomSource, mode, label, document } = params;
  return {
    id: mintId(),
    label,
    revision: 0,
    mode,
    scopeElementIds: scopeElementIdsAtDraftOpen(document),
    entryPorts: [],
    inputs: [],
    workloads: [],
    faults: [],
    boundaries: [],
    refinementSelections: [],
    initialContexts: [],
    assertions: [],
    seed: drawSeed(randomSource),
    budgets: DEFAULT_SCENARIO_BUDGETS,
    completion: defaultCompletionForMode(mode),
    assumptions: [],
  };
}

// ============================================================================
// Issue linking (validator/readiness issues -> editor sections)
// ============================================================================

function sectionForField(field: string | number | undefined): ScenarioSection {
  switch (field) {
    case 'label':
      return 'header';
    case 'workloads':
      return 'traffic';
    case 'inputs':
      return 'steps';
    case 'faults':
      return 'faults';
    case 'boundaries':
      return 'boundaries';
    case 'assertions':
      return 'assertions';
    case 'seed':
    case 'budgets':
    case 'completion':
      return 'runSettings';
    default:
      return 'general';
  }
}

function emptyIssuesBySection(): Record<ScenarioSection, ScenarioIssue[]> {
  const record = {} as Record<ScenarioSection, ScenarioIssue[]>;
  for (const section of SCENARIO_SECTIONS) {
    record[section] = [];
  }
  return record;
}

/**
 * Builds a candidate Document with `candidate` inserted (new) or replacing the scenario
 * `sourceScenarioId` (edit) at the same index, runs the storable validator over the
 * whole document, and -- only when storable is clean -- runs readiness for this
 * scenario (model-and-runner.md §1: "Readiness errors never block saving a structurally
 * valid design", so readiness only needs checking once storable already passes).
 * Storable issues are filtered to this scenario's own subtree (`path[0] === 'scenarios'
 * && path[1] === candidateIndex`); readiness issues are already scoped to one scenario
 * by `checkReadiness(doc, scenarioId)`.
 */
export function computeScenarioIssues(
  document: Document,
  candidate: Scenario,
  sourceScenarioId: Id | null,
): {
  readonly issuesBySection: Readonly<Record<ScenarioSection, readonly ScenarioIssue[]>>;
  readonly allIssues: readonly ScenarioIssue[];
} {
  const matchId = sourceScenarioId ?? candidate.id;
  const existingIndex = document.scenarios.findIndex((s) => s.id === matchId);
  const scenarios =
    existingIndex >= 0
      ? document.scenarios.map((s, i) => (i === existingIndex ? candidate : s))
      : [...document.scenarios, candidate];
  const candidateIndex = existingIndex >= 0 ? existingIndex : scenarios.length - 1;
  const candidateDocument: Document = { ...document, scenarios };

  const storableResult = validateDocument(candidateDocument);
  const allIssues: ScenarioIssue[] = [];

  if (!storableResult.ok) {
    for (const issue of storableResult.issues) {
      if (issue.path[0] === 'scenarios' && issue.path[1] === candidateIndex) {
        allIssues.push(issue);
      }
    }
  } else {
    const readiness = checkReadiness(candidateDocument, candidate.id);
    if (!readiness.ready) {
      for (const issue of readiness.issues) {
        allIssues.push(issue);
      }
    }
  }

  const issuesBySection = emptyIssuesBySection();
  for (const issue of allIssues) {
    const field = issue.path[2];
    issuesBySection[sectionForField(field)].push(issue);
  }

  return { issuesBySection, allIssues };
}

// ============================================================================
// Draft lifecycle
// ============================================================================

/**
 * commands.md §5: "scenario.new ... Opens the scenario editor on an unsaved draft" /
 * "scenario.edit = inspector.open with DraftTarget{kind:'scenario', ...}". This module's
 * own `ScenarioDraftTarget` covers both scenario.new/duplicate (`kind:'new'`) and
 * scenario.edit (`kind:'edit'`).
 *
 * For `kind:'edit'` against an unknown scenarioId, returns a `missing` handle (the
 * target may have been deleted elsewhere) rather than throwing -- mirroring
 * inspector/draft.ts's `openDraft` for a deleted element/connection.
 */
export function openScenarioDraft(params: {
  readonly draftId: Id;
  readonly target: ScenarioDraftTarget;
  readonly document: Document;
  readonly baseWorkingRevision: number;
  readonly mintId: MintId;
  readonly randomSource: RandomSource;
}): ScenarioDraftHandle {
  const { draftId, target, document, baseWorkingRevision, mintId, randomSource } = params;

  if (target.kind === 'edit') {
    const source = document.scenarios.find((s) => s.id === target.scenarioId) ?? null;
    if (!source) {
      return Object.freeze({
        draftId,
        target,
        baseWorkingRevision,
        isNew: false,
        sourceScenarioId: target.scenarioId,
        scenario: null,
        baseScenario: null,
        dirty: false,
        status: 'missing',
        issuesBySection: emptyIssuesBySection(),
        allIssues: [],
        generalIssue: null,
      });
    }
    return Object.freeze({
      draftId,
      target,
      baseWorkingRevision,
      isNew: false,
      sourceScenarioId: source.id,
      scenario: source,
      baseScenario: source,
      dirty: false,
      status: 'clean',
      ...computeScenarioIssues(document, source, source.id),
      generalIssue: null,
    });
  }

  // target.kind === 'new'
  const from = target.from;
  let scenario: Scenario;
  if (from.kind === 'empty') {
    scenario = buildEmptyScenario({ mintId, randomSource, mode: target.mode, label: target.label, document });
  } else {
    const source = document.scenarios.find((s) => s.id === from.scenarioId);
    if (!source) {
      throw new Error(
        `scenario.new: copy source '${from.scenarioId}' does not exist -- caller must only offer copy of an existing scenario`,
      );
    }
    if (source.mode !== target.mode) {
      // commands.md §4: "mode must equal the copied scenario's mode." The caller (the
      // New scenario dialog) must not let mode diverge from the chosen copy source.
      throw new Error(
        `scenario.new: mode '${target.mode}' must equal the copied scenario's mode '${source.mode}'`,
      );
    }
    scenario = remapScenarioForCopy(source, mintId, target.label);
  }

  return Object.freeze({
    draftId,
    target,
    baseWorkingRevision,
    isNew: true,
    sourceScenarioId: null,
    scenario,
    baseScenario: scenario,
    dirty: false,
    status: 'clean',
    ...computeScenarioIssues(document, scenario, null),
    generalIssue: null,
  });
}

/**
 * commands.md §6: "The only bridge methods are changeField(...), validateDraft(),
 * applyDraft() and cancelDraft()." This module's equivalent of changeField+validateDraft
 * combined: applies a typed patch to the candidate and immediately re-links
 * validator/readiness issues, so the editor's per-section errors stay live.
 */
export function changeScenarioDraft(
  handle: ScenarioDraftHandle,
  document: Document,
  patch: (scenario: Scenario) => Scenario,
): ScenarioDraftHandle {
  if (handle.scenario === null) return handle;
  const scenario = patch(handle.scenario);
  const { issuesBySection, allIssues } = computeScenarioIssues(document, scenario, handle.sourceScenarioId);
  return Object.freeze({
    ...handle,
    scenario,
    dirty: true,
    status: 'editing',
    issuesBySection,
    allIssues,
    generalIssue: null,
  });
}

/**
 * commands.md §6 Cancel: "discards the draft and reloads accepted values." Returns the
 * draft to its base value; the caller then closes the editor (Cancel itself stores
 * nothing, per scenario.new/duplicate).
 */
export function cancelScenarioDraft(handle: ScenarioDraftHandle): ScenarioDraftHandle {
  return Object.freeze({
    ...handle,
    scenario: handle.baseScenario,
    dirty: false,
    status: handle.baseScenario === null ? 'missing' : 'clean',
    issuesBySection: emptyIssuesBySection(),
    allIssues: [],
    generalIssue: null,
  });
}

function hasBlockingIssues(handle: ScenarioDraftHandle): boolean {
  return handle.allIssues.some((i) => i.severity === 'error');
}

/**
 * commands.md §6 Apply: "parses, validates the candidate and revision, persists one
 * compound command, clears dirty state and adds one undo entry." "While pending,
 * duplicate submits and navigation are blocked" is the caller's (ScenarioEditor's)
 * responsibility via `status === 'saving'`.
 *
 * Validation failures (storable or readiness) keep the draft and report the linked
 * per-section field errors already computed by changeScenarioDraft/openScenarioDraft --
 * this is the brief's "apply blocked with linked field errors while the
 * validator/readiness reports issues."
 */
export async function applyScenarioDraft(
  handle: ScenarioDraftHandle,
  session: ScenarioDraftSession,
): Promise<ScenarioDraftHandle> {
  if (handle.scenario === null) {
    return Object.freeze({ ...handle, status: 'missing' });
  }

  const sessionState = session.getState();
  const document = sessionState.document;
  if (!document) {
    return Object.freeze({ ...handle, status: 'stale' });
  }

  const { issuesBySection, allIssues } = computeScenarioIssues(document, handle.scenario, handle.sourceScenarioId);
  const withIssues: ScenarioDraftHandle = Object.freeze({ ...handle, issuesBySection, allIssues });

  if (allIssues.some((i) => i.severity === 'error')) {
    return Object.freeze({ ...withIssues, status: 'invalid' });
  }

  if (!handle.dirty && !handle.isNew) {
    // Nothing changed: treat as a clean close, no command submitted.
    return Object.freeze({ ...withIssues, status: 'clean', dirty: false });
  }

  if (sessionState.workingRevision === null || sessionState.workingRevision !== handle.baseWorkingRevision) {
    return Object.freeze({ ...withIssues, status: 'stale' });
  }

  const savingHandle: ScenarioDraftHandle = Object.freeze({ ...withIssues, status: 'saving' });

  let outgoingScenario = handle.scenario;
  let change: RecordChange;
  if (handle.isNew) {
    change = { kind: 'insert', value: { recordKind: 'scenario', record: outgoingScenario } };
  } else {
    const currentRecord = document.scenarios.find((s) => s.id === handle.sourceScenarioId) ?? null;
    if (!currentRecord) {
      // Target deleted elsewhere: stale/missing, candidate text is kept (commands.md §6).
      return Object.freeze({ ...withIssues, status: 'stale' });
    }
    // model-and-runner.md §6: "revision ... increments on any edit, including a label
    // change." The draft's own `scenario.revision` reflects the value it was opened
    // from (or 0 for a copy); the outgoing record bumps from the *current session*
    // record's revision so a concurrently-applied unrelated edit (already ruled out
    // above by the working-revision stale check) is never silently skipped.
    outgoingScenario = { ...handle.scenario, revision: currentRecord.revision + 1 };
    change = { kind: 'replace', value: { recordKind: 'scenario', record: outgoingScenario } };
  }

  const label = handle.isNew ? `Add scenario "${outgoingScenario.label}"` : `Edit scenario "${outgoingScenario.label}"`;
  const result: AuthoredResult = await session.apply([change], label);

  if (result.status === 'applied') {
    const newWorkingRevision = session.getState().workingRevision;
    if (newWorkingRevision === null) {
      throw new Error(
        'Contract violation: session.getState().workingRevision is null after an applied scenario edit',
      );
    }
    return Object.freeze({
      ...savingHandle,
      isNew: false,
      sourceScenarioId: outgoingScenario.id,
      scenario: outgoingScenario,
      baseScenario: outgoingScenario,
      baseWorkingRevision: newWorkingRevision,
      dirty: false,
      status: 'clean',
      issuesBySection: emptyIssuesBySection(),
      allIssues: [],
      generalIssue: null,
    });
  }

  if (result.status === 'stale') {
    return Object.freeze({ ...savingHandle, status: 'stale' });
  }

  if (result.status === 'missing') {
    return Object.freeze({ ...savingHandle, status: 'stale' });
  }

  if (result.status === 'invalid') {
    const bucketed = emptyIssuesBySection();
    for (const issue of result.issues) {
      bucketed[sectionForField(issue.path[2])].push(issue);
    }
    return Object.freeze({
      ...savingHandle,
      status: 'invalid',
      issuesBySection: bucketed,
      allIssues: result.issues,
    });
  }

  // failed (quota/unavailable/etc.)
  return Object.freeze({
    ...savingHandle,
    status: 'invalid',
    generalIssue: 'Could not save. Try again.',
  });
}

// ============================================================================
// Delete (commands.md §4 scenario.delete)
// ============================================================================

/**
 * commands.md §4 scenario.delete: "Confirmation first ... One model.apply-records
 * remove; one undo." Confirmation itself is the DeleteScenarioDialog component; this is
 * the compound command it submits once confirmed.
 */
export function buildDeleteScenarioChange(scenarioId: Id): RecordChange {
  return { kind: 'remove', recordKind: 'scenario', id: scenarioId };
}

export async function deleteScenario(
  scenarioId: Id,
  label: string,
  session: ScenarioDraftSession,
): Promise<AuthoredResult> {
  return session.apply([buildDeleteScenarioChange(scenarioId)], `Delete scenario "${label}"`);
}

export { hasBlockingIssues };
