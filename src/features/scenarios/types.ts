/**
 * Scenario module types (RV-05c).
 *
 * Implements specs/revamp/contracts/commands.md "Scenarios (D41)" and "Draft lifecycle"
 * (§6): scenario.new / scenario.duplicate / scenario.delete / scenario.edit, and the
 * open/change/validate/apply/cancel draft pattern -- built self-contained here because
 * this module is not wired into the shell and `DraftTarget` in
 * src/features/inspector/types.ts is explicitly scoped to 'element' | 'connection' only
 * (out of scope for that task). `ScenarioDraftTarget` below is this module's own
 * `DraftTarget{kind:'scenario'}` equivalent.
 *
 * Unlike the inspector's single-scalar-field FieldSpec bridge (changeField(fieldId,
 * rawValue): string in / string out), a Scenario is a large nested record with typed
 * arrays (workloads, inputs, faults, boundaries, assertions...). "Typed controls, never
 * raw JSON" is satisfied here by a typed patch function (`ScenarioPatch`) instead of a
 * raw-string field bridge: every UI control calls a typed setter that produces a full
 * candidate `Scenario`, which is then (re)validated as a whole. Raw strings for numeric
 * fields are still parsed by the field's own control before entering the Scenario (see
 * fields.ts), so "raw strings never enter the Document" still holds.
 */

import type { Document, Id, ScenarioMode } from '../../domain/studio/model';
import type { Issue } from '../../domain/studio/validate';
import type { ReadinessIssue } from '../../domain/studio/readiness';
import type { AuthoredResult, RecordChange } from '../../persistence/studio/types';
import type { DraftScenario } from './draftScenario';

/**
 * A validator (storable) or readiness (runnable) issue, unified for editor display.
 * `ReadinessIssue`'s `code` union is a strict superset of `Issue`'s (it re-admits every
 * storable code plus readiness-only and closure-passthrough codes) -- see
 * src/domain/studio/readiness.ts's `ReadinessIssue` doc comment.
 */
export type ScenarioIssue = Issue | ReadinessIssue;

// ============================================================================
// Injected sources (commands.md §6: "the only bridge methods"; brief: "seed drawn
// at random via an injected random source", IDs "come from the injected/session
// mintId")
// ============================================================================

/** Returns a float in [0, 1), like `Math.random()`. Injected so tests are deterministic. */
export type RandomSource = () => number;

export type MintId = () => Id;

// ============================================================================
// DraftTarget (this module's own, scenario-only, equivalent of commands.md §5)
// ============================================================================

export type ScenarioDraftTarget =
  | { readonly kind: 'new'; readonly mode: ScenarioMode; readonly from: ScenarioNewFrom; readonly label: string }
  | { readonly kind: 'edit'; readonly scenarioId: Id };

export type ScenarioNewFrom = { readonly kind: 'empty' } | { readonly kind: 'copy'; readonly scenarioId: Id };

// ============================================================================
// Sections (for linking validator/readiness issues to editor sections)
// ============================================================================

/**
 * commands.md §6 "Editor sections": header; What goes in (traffic = workloads /
 * steps = inputs); What happens during the run (faults / boundaries); What should be
 * true (assertions); Run settings (completion, seed, budgets). `general` covers
 * scenario-level fields with no dedicated section (scope, entryPorts,
 * refinementSelections, initialContexts, assumptions).
 */
export const SCENARIO_SECTIONS = [
  'header',
  'traffic',
  'steps',
  'faults',
  'boundaries',
  'assertions',
  'runSettings',
  'general',
] as const;
export type ScenarioSection = (typeof SCENARIO_SECTIONS)[number];

// ============================================================================
// Draft handle
// ============================================================================

export type ScenarioDraftStatus = 'clean' | 'editing' | 'saving' | 'invalid' | 'stale' | 'missing';

export type ScenarioDraftHandle = {
  readonly draftId: Id;
  readonly target: ScenarioDraftTarget;
  readonly baseWorkingRevision: number;
  /** True for scenario.new / scenario.duplicate (insert on Apply); false for scenario.edit (replace). */
  readonly isNew: boolean;
  /** The scenario id this draft edits, or null for a still-unsaved new draft. */
  readonly sourceScenarioId: Id | null;
  /**
   * The current in-memory candidate value. Never written to the Document until Apply.
   * Null only for `target.kind === 'edit'` against a scenario that no longer exists
   * (deleted elsewhere) -- `status` is then `'missing'`.
   */
  readonly scenario: DraftScenario | null;
  /** The accepted (baseline) value; equals `scenario` when `dirty` is false. */
  readonly baseScenario: DraftScenario | null;
  readonly dirty: boolean;
  readonly status: ScenarioDraftStatus;
  readonly issuesBySection: Readonly<Record<ScenarioSection, readonly ScenarioIssue[]>>;
  /** Flattened union of every section's issues, in validator order. */
  readonly allIssues: readonly ScenarioIssue[];
  /** A save/apply failure not tied to any field (storage quota, etc). */
  readonly generalIssue: string | null;
};

// ============================================================================
// Session bridge (transactions.md §3 / commands.md §6, narrowed like
// inspector/types.ts's DraftSession so draft.ts stays testable against a fake)
// ============================================================================

export type ScenarioDraftSession = {
  getState: () => {
    readonly workingRevision: number | null;
    readonly document: Document | null;
  };
  apply: (changes: readonly RecordChange[], label: string) => Promise<AuthoredResult>;
};

export type ApplyScenarioDraftResult = {
  readonly handle: ScenarioDraftHandle;
};
