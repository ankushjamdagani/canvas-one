/**
 * Scenario draft lifecycle: pure logic.
 *
 * - scenario.new / scenario.duplicate open the editor on an unsaved draft; nothing is
 *   stored until Apply, which inserts the scenario as one record change and one undo
 *   step. Cancel stores nothing.
 * - Empty drafts invent nothing: no workloads/inputs/faults/boundaries/assertions;
 *   scope = every element in the document at draft time; the only prefilled values are
 *   the default budgets and a seed drawn at random when the draft opens (shown and
 *   editable).
 * - scenario.delete is one record removal and one undo step.
 * - Lifecycle: open/change/validate/apply/cancel. Apply parses and validates the
 *   candidate and revision, persists one compound command, clears dirty state and adds
 *   one undo entry; a stale draft never silently rebases; if the target is deleted
 *   elsewhere, the draft is marked stale/missing.
 *
 * See types.ts for why this uses a typed-patch bridge instead of the inspector's
 * raw-string FieldSpec bridge.
 */

import type { Document, Id, ScenarioMode } from '../../studio/model.js';
import { validateDocument } from '../../studio/validate.js';
import { checkReadiness } from '../../studio/readiness.js';
import type { RecordChange } from '../../studio/records.js';
import type { ScenarioApplyOutcome } from './types.js';
import { DEFAULT_SCENARIO_BUDGETS, drawSeed } from './budgets.js';
import { remapScenarioForCopy } from './idRemap.js';
import {
  SCENARIO_SECTIONS,
  type MintId,
  type RandomSource,
  type ScenarioDraftHandle,
  type ScenarioDraftSession,
  type ScenarioDraftTarget,
  type ScenarioIssue,
  type ScenarioSection,
} from './types.js';
import {
  scenarioToDraft,
  toStorableScenario,
  toValidationScenario,
  type DraftScenario,
} from './draftScenario.js';

// ============================================================================
// Empty draft construction ("Empty drafts invent nothing")
// ============================================================================

function scopeElementIdsAtDraftOpen(document: Document): readonly Id[] {
  return document.elements.map((e) => e.id);
}

/**
 * Builds a brand-new, unsaved
 * DraftScenario with no workloads/inputs/faults/boundaries/assertions, scope = every
 * element in the document right now, default budgets, a freshly drawn
 * seed. A workload added later has no emission until the user picks bulk or stream and
 * fills its values; see draftScenario.ts's DraftEmission and draftCompletenessIssues below.
 * `revision: 0` -- a never-yet-persisted record; see idRemap.ts's
 * remapScenarioForCopy for the same choice on a copy.
 *
 * `entryPorts: []` and stays that way: closure.ts seeds scope from `entryPorts`,
 * every `input.entry` and every `workload.entry` combined (see
 * closure.ts "Start from the scenario entry points"), so inputs/workloads alone
 * already make the scenario's entry points reachable. No readiness rule requires
 * `entryPorts` itself to be non-empty, so it is never something the user is forced to
 * author separately, and this module offers no editor for it.
 */
export function buildEmptyScenario(params: {
  readonly mintId: MintId;
  readonly randomSource: RandomSource;
  readonly mode: ScenarioMode;
  readonly label: string;
  readonly document: Document;
}): DraftScenario {
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
 * A locally-crafted issue for a value the draft layer requires but the stored
 * `Scenario` schema has no field-presence check for (its type simply isn't optional):
 * "not yet chosen" only exists at the draft layer, so the storable/readiness
 * validators can never report it themselves. Shaped exactly like `Issue`
 * (`{code,path,entityId,severity,message}`) so it flows through the same
 * `issuesBySection`/`allIssues` plumbing; `path` mirrors the `['scenarios', <index>,
 * field, ...]` shape `sectionForField` already reads (index 0 is a placeholder --
 * never used to look anything up, only `path[2]` is read).
 */
function draftIssue(entityId: Id, field: string, message: string): ScenarioIssue {
  return { code: 'structural-rule', path: ['scenarios', 0, field], entityId, severity: 'error', message };
}

/**
 * Everything the record requires but the
 * user hasn't chosen yet blocks Apply. Reports exactly the three draft-only "unset"
 * states (see draftScenario.ts): each workload's emission, each workload class's key
 * distribution, each output/context assertion's path.
 */
function draftCompletenessIssues(draft: DraftScenario): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];

  for (const workload of draft.workloads) {
    const e = workload.emission;
    if (e.mode === null) {
      issues.push(draftIssue(draft.id, 'workloads', 'Choose whether this traffic is a bulk of requests or a stream'));
    } else if (e.mode === 'bulk') {
      const spread = e.arrival === null || e.arrival === 'instant' ? undefined : 'spreadMs' in e.arrival ? e.arrival.spreadMs : e.arrival.ramp.spreadMs;
      if (e.requests === null) issues.push(draftIssue(draft.id, 'workloads', 'Enter how many requests the bulk sends'));
      if (e.arrival === null) issues.push(draftIssue(draft.id, 'workloads', 'Choose how the bulk is spread'));
      else if (spread === null) issues.push(draftIssue(draft.id, 'workloads', 'Enter the time the bulk is spread over'));
    } else {
      const p = e.profile;
      if (e.ratePerSecond === null) issues.push(draftIssue(draft.id, 'workloads', 'Enter the stream rate'));
      if ((p.kind === 'burst' && (p.peakRate === null || p.startMs === null || p.endMs === null)) || (p.kind === 'ramp' && (p.endRate === null || p.rampMs === null))) {
        issues.push(draftIssue(draft.id, 'workloads', p.kind === 'burst' ? 'Enter the burst rate, start and end' : 'Enter the ramp end rate and how long it takes'));
      }
    }
    for (const cls of workload.classes) {
      const kd = cls.keyDistribution;
      if (kd.kind === null || kd.catalogSize === null || kd.hotSubset === null || kd.hotShare === null) {
        issues.push(draftIssue(draft.id, 'workloads', `Choose how keys are distributed for "${cls.name}"`));
      }
    }
  }

  for (const assertion of draft.assertions) {
    if ((assertion.subject.kind === 'output' || assertion.subject.kind === 'context') && assertion.subject.path === null) {
      issues.push(draftIssue(draft.id, 'assertions', `Choose which part of the value "${assertion.label}" checks`));
    }
  }

  return issues;
}

/**
 * Builds a candidate Document with `candidate` (converted to its best-effort stored
 * shape via `toValidationScenario` -- see that function's doc comment on why this is
 * safe) inserted (new) or replacing the scenario `sourceScenarioId` (edit) at the same
 * index, runs the storable validator over the whole document, and -- only when
 * storable is clean -- runs readiness for this scenario (readiness errors never block saving
 * a structurally valid design, so readiness only needs checking once storable already passes). Storable issues are filtered to this
 * scenario's own subtree (`path[0] === 'scenarios' && path[1] === candidateIndex`);
 * readiness issues are already scoped to one scenario by `checkReadiness(doc,
 * scenarioId)`. `draftCompletenessIssues` issues are always included regardless.
 */
export function computeScenarioIssues(
  document: Document,
  candidate: DraftScenario,
  sourceScenarioId: Id | null,
): {
  readonly issuesBySection: Readonly<Record<ScenarioSection, readonly ScenarioIssue[]>>;
  readonly allIssues: readonly ScenarioIssue[];
} {
  const validationScenario = toValidationScenario(candidate);
  const matchId = sourceScenarioId ?? candidate.id;
  const existingIndex = document.scenarios.findIndex((s) => s.id === matchId);
  const scenarios =
    existingIndex >= 0
      ? document.scenarios.map((s, i) => (i === existingIndex ? validationScenario : s))
      : [...document.scenarios, validationScenario];
  const candidateIndex = existingIndex >= 0 ? existingIndex : scenarios.length - 1;
  const candidateDocument: Document = { ...document, scenarios };

  const storableResult = validateDocument(candidateDocument);
  const allIssues: ScenarioIssue[] = [...draftCompletenessIssues(candidate)];

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
 * Opens a draft for scenario.new (an unsaved draft) or scenario.edit (the inspector
 * opened on a scenario). This module's
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
    const draftScenario = scenarioToDraft(source);
    return Object.freeze({
      draftId,
      target,
      baseWorkingRevision,
      isNew: false,
      sourceScenarioId: source.id,
      scenario: draftScenario,
      baseScenario: draftScenario,
      dirty: false,
      status: 'clean',
      ...computeScenarioIssues(document, draftScenario, source.id),
      generalIssue: null,
    });
  }

  // target.kind === 'new'
  const from = target.from;
  let scenario: DraftScenario;
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
      // The mode must equal the copied scenario's mode. The caller (the
      // New scenario dialog) must not let mode diverge from the chosen copy source.
      throw new Error(
        `scenario.new: mode '${target.mode}' must equal the copied scenario's mode '${source.mode}'`,
      );
    }
    scenario = scenarioToDraft(remapScenarioForCopy(source, mintId, target.label));
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
 * The equivalent of changeField+validateDraft
 * combined: applies a typed patch to the candidate and immediately re-links
 * validator/readiness issues, so the editor's per-section errors stay live.
 */
export function changeScenarioDraft(
  handle: ScenarioDraftHandle,
  document: Document,
  patch: (scenario: DraftScenario) => DraftScenario,
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
 * Parses and validates the candidate and revision, persists one compound command,
 * clears dirty state and adds one undo entry. Blocking duplicate submits and navigation
 * while pending is the caller's (ScenarioEditor's)
 * responsibility via `status === 'saving'`.
 *
 * Validation failures (storable or readiness) keep the draft and report the linked
 * per-section field errors already computed by changeScenarioDraft/openScenarioDraft,
 * so Apply stays blocked while the validator/readiness reports issues.
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

  // No error-severity issue survived the check above, so every draft-only "unset"
  // field (completion / keyDistribution / assertion path) is filled -- this can never
  // return null here; `draftCompletenessIssues` (folded into `allIssues` above) and
  // this function agree exactly on what counts as unset.
  const storableCandidate = toStorableScenario(handle.scenario);
  if (!storableCandidate) {
    throw new Error(
      'Contract violation: toStorableScenario returned null after computeScenarioIssues reported no blocking issues',
    );
  }

  const savingHandle: ScenarioDraftHandle = Object.freeze({ ...withIssues, status: 'saving' });

  let outgoingScenario = storableCandidate;
  let change: RecordChange;
  if (handle.isNew) {
    change = { kind: 'insert', value: { recordKind: 'scenario', record: outgoingScenario } };
  } else {
    const currentRecord = document.scenarios.find((s) => s.id === handle.sourceScenarioId) ?? null;
    if (!currentRecord) {
      // Target deleted elsewhere: stale/missing, candidate text is kept.
      return Object.freeze({ ...withIssues, status: 'stale' });
    }
    // A scenario's revision increments on any edit, including a label
    // change. The draft's own `scenario.revision` reflects the value it was opened
    // from (or 0 for a copy); the outgoing record bumps from the *current session*
    // record's revision so a concurrently-applied unrelated edit (already ruled out
    // above by the working-revision stale check) is never silently skipped.
    outgoingScenario = { ...storableCandidate, revision: currentRecord.revision + 1 };
    change = { kind: 'replace', value: { recordKind: 'scenario', record: outgoingScenario } };
  }

  const label = handle.isNew ? `Add scenario "${outgoingScenario.label}"` : `Edit scenario "${outgoingScenario.label}"`;
  const result: ScenarioApplyOutcome = await session.apply([change], label);

  if (result.status === 'applied') {
    const newWorkingRevision = session.getState().workingRevision;
    if (newWorkingRevision === null) {
      throw new Error(
        'Contract violation: session.getState().workingRevision is null after an applied scenario edit',
      );
    }
    const acceptedDraft = scenarioToDraft(outgoingScenario);
    return Object.freeze({
      ...savingHandle,
      isNew: false,
      sourceScenarioId: outgoingScenario.id,
      scenario: acceptedDraft,
      baseScenario: acceptedDraft,
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
// Delete
// ============================================================================

/**
 * Removing a scenario needs confirmation first and is one record removal and one undo
 * step. Confirmation itself is the DeleteScenarioDialog component; this is
 * the compound command it submits once confirmed.
 */
function buildDeleteScenarioChange(scenarioId: Id): RecordChange {
  return { kind: 'remove', recordKind: 'scenario', id: scenarioId };
}

export async function deleteScenario(
  scenarioId: Id,
  label: string,
  session: ScenarioDraftSession,
): Promise<ScenarioApplyOutcome> {
  return session.apply([buildDeleteScenarioChange(scenarioId)], `Delete scenario "${label}"`);
}
