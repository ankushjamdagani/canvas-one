/**
 * DraftScenario: the in-progress, possibly-incomplete editing shape.
 *
 * Empty drafts invent nothing: the only prefilled values are the default budgets and a
 * seed drawn at random when the draft opens. Every other value the stored `Scenario` record requires must be entered by
 * the user before Apply.
 *
 * Three stored fields can't hold "not yet chosen" while still typing as their stored
 * shape, so the *draft* layer widens exactly those three to admit an explicit "unset"
 * state -- never the stored `Scenario` type (draft.ts converts back with
 * `toStorableScenario`, which returns null while anything is unset, and Apply is
 * blocked whenever it does):
 * - each workload's `emission` (bulk or stream, with the values that mode needs).
 * - each workload request class's `keyDistribution`: `RequestClass.keyDistribution` is a required, always-present object regardless of
 *   `kind`, per `src/domain/studio/validate.ts`'s `validateRequestClass`).
 * - each `output`/`context` assertion subject's `path`: `output`/`context` subjects carry a required `Path`; `[]` -- "the whole
 *   value" -- is a legitimate value, but only once the user has explicitly picked it).
 *
 * Every other DraftScenario field is identical to `Scenario` and is never partially
 * typed -- e.g. `label` is exactly what the user typed into the New scenario dialog
 * (never blank at draft-open), and array fields (`inputs`, `faults`, `boundaries`,
 * `assertions` themselves) start empty per "Empty drafts invent nothing" and are only
 * ever added to via a picker that produces a fully-formed record in one step (see
 * TrafficSection.tsx/StepsSection.tsx/FaultsSection.tsx: every add-row control forces
 * a real document reference before the row can exist at all).
 */

import type {
  Assertion,
  AssertionSubject,
  Emission,
  Json,
  KeyDistribution,
  Path,
  RequestClass,
  Scenario,
  Workload,
  WorkloadProfile,
} from '../../domain/studio/model';

// ============================================================================
// DraftKeyDistribution
// ============================================================================

export type DraftKeyDistribution = {
  readonly kind: 'uniform' | 'hot' | null;
  readonly catalogSize: number | null;
  readonly hotSubset: number | null;
  readonly hotShare: number | null;
};

export const UNSET_KEY_DISTRIBUTION: DraftKeyDistribution = {
  kind: null,
  catalogSize: null,
  hotSubset: null,
  hotShare: null,
};

function keyDistributionToDraft(kd: KeyDistribution): DraftKeyDistribution {
  return kd;
}

function draftKeyDistributionToStorable(kd: DraftKeyDistribution): KeyDistribution | null {
  if (kd.kind === null || kd.catalogSize === null || kd.hotSubset === null || kd.hotShare === null) return null;
  return { kind: kd.kind, catalogSize: kd.catalogSize, hotSubset: kd.hotSubset, hotShare: kd.hotShare };
}

export type DraftRequestClass = Omit<RequestClass, 'keyDistribution'> & {
  readonly keyDistribution: DraftKeyDistribution;
};

/**
 * Burst and ramp fields start unset when the author picks the shape; Apply is blocked
 * until they're typed.
 */
export type DraftWorkloadProfile =
  | { readonly kind: 'steady' }
  | { readonly kind: 'burst'; readonly peakRate: number | null; readonly startMs: number | null; readonly endMs: number | null }
  | { readonly kind: 'ramp'; readonly endRate: number | null; readonly rampMs: number | null };

function draftProfileToStorable(p: DraftWorkloadProfile): WorkloadProfile | null {
  if (p.kind === 'burst') {
    if (p.peakRate === null || p.startMs === null || p.endMs === null) return null;
    return { kind: 'burst', peakRate: p.peakRate, startMs: p.startMs, endMs: p.endMs };
  }
  if (p.kind === 'ramp') return p.endRate === null || p.rampMs === null ? null : { kind: 'ramp', endRate: p.endRate, rampMs: p.rampMs };
  return { kind: 'steady' };
}

/** How a bulk's requests spread; each value stays individually nullable until typed. */
export type DraftBulkArrival =
  | 'instant'
  | { readonly spreadMs: number | null }
  | { readonly ramp: { readonly spreadMs: number | null } };

/**
 * `mode: null` = nothing chosen yet. Once bulk or stream is picked, its own values stay
 * individually nullable so partial entry isn't lost on every keystroke elsewhere in the form.
 */
export type DraftEmission =
  | { readonly mode: null }
  | { readonly mode: 'bulk'; readonly requests: number | null; readonly arrival: DraftBulkArrival | null }
  | { readonly mode: 'stream'; readonly ratePerSecond: number | null; readonly profile: DraftWorkloadProfile };

export const UNSET_EMISSION: DraftEmission = { mode: null };

function draftEmissionToStorable(e: DraftEmission): Emission | null {
  if (e.mode === null) return null;
  if (e.mode === 'stream') {
    const profile = draftProfileToStorable(e.profile);
    return e.ratePerSecond === null || profile === null ? null : { mode: 'stream', ratePerSecond: e.ratePerSecond, profile };
  }
  if (e.requests === null || e.arrival === null) return null;
  if (e.arrival === 'instant') return { mode: 'bulk', requests: e.requests, arrival: 'instant' };
  if ('spreadMs' in e.arrival) {
    return e.arrival.spreadMs === null ? null : { mode: 'bulk', requests: e.requests, arrival: { spreadMs: e.arrival.spreadMs } };
  }
  return e.arrival.ramp.spreadMs === null
    ? null
    : { mode: 'bulk', requests: e.requests, arrival: { ramp: { spreadMs: e.arrival.ramp.spreadMs } } };
}

export type DraftWorkload = Omit<Workload, 'classes' | 'emission'> & {
  readonly emission: DraftEmission;
  readonly classes: readonly DraftRequestClass[];
};

function requestClassToDraft(c: RequestClass): DraftRequestClass {
  return { ...c, keyDistribution: keyDistributionToDraft(c.keyDistribution) };
}

function draftRequestClassToStorable(c: DraftRequestClass): RequestClass | null {
  const keyDistribution = draftKeyDistributionToStorable(c.keyDistribution);
  if (keyDistribution === null) return null;
  return { ...c, keyDistribution };
}

function workloadToDraft(w: Workload): DraftWorkload {
  return { ...w, classes: w.classes.map(requestClassToDraft) };
}

function draftWorkloadToStorable(w: DraftWorkload): Workload | null {
  const emission = draftEmissionToStorable(w.emission);
  if (emission === null) return null;
  const classes: RequestClass[] = [];
  for (const c of w.classes) {
    const stored = draftRequestClassToStorable(c);
    if (stored === null) return null;
    classes.push(stored);
  }
  return { ...w, emission, classes };
}

// ============================================================================
// DraftAssertion (output/context subject path)
// ============================================================================

export type DraftAssertionSubject =
  | Exclude<AssertionSubject, { kind: 'output' } | { kind: 'context' }>
  | { readonly kind: 'output'; readonly port: { readonly elementId: string; readonly portId: string }; readonly path: Path | null }
  | { readonly kind: 'context'; readonly elementId: string; readonly path: Path | null };

export type DraftAssertion = Omit<Assertion, 'subject'> & { readonly subject: DraftAssertionSubject };

function assertionSubjectToDraft(subject: AssertionSubject): DraftAssertionSubject {
  if (subject.kind === 'output' || subject.kind === 'context') {
    return { ...subject, path: subject.path };
  }
  return subject;
}

function draftAssertionSubjectToStorable(subject: DraftAssertionSubject): AssertionSubject | null {
  if (subject.kind === 'output' || subject.kind === 'context') {
    if (subject.path === null) return null;
    return { ...subject, path: subject.path };
  }
  return subject;
}

function assertionToDraft(a: Assertion): DraftAssertion {
  return { ...a, subject: assertionSubjectToDraft(a.subject) };
}

function draftAssertionToStorable(a: DraftAssertion): Assertion | null {
  const subject = draftAssertionSubjectToStorable(a.subject);
  if (subject === null) return null;
  return { ...a, subject };
}

// ============================================================================
// DraftScenario
// ============================================================================

export type DraftScenario = Omit<Scenario, 'workloads' | 'assertions'> & {
  readonly workloads: readonly DraftWorkload[];
  readonly assertions: readonly DraftAssertion[];
};

/** A fully-authored, persisted Scenario always converts losslessly to a DraftScenario. */
export function scenarioToDraft(scenario: Scenario): DraftScenario {
  return {
    ...scenario,
    workloads: scenario.workloads.map(workloadToDraft),
    assertions: scenario.assertions.map(assertionToDraft),
  };
}

/**
 * Returns the stored Scenario once every workload's emission, every workload class's key
 * distribution, and every output/context assertion path are chosen; otherwise null.
 * Callers must not Apply while this is null (draft.ts's completeness-issue check
 * always agrees with this function about what's missing).
 */
export function toStorableScenario(draft: DraftScenario): Scenario | null {
  const workloads: Workload[] = [];
  for (const w of draft.workloads) {
    const stored = draftWorkloadToStorable(w);
    if (stored === null) return null;
    workloads.push(stored);
  }

  const assertions: Assertion[] = [];
  for (const a of draft.assertions) {
    const stored = draftAssertionToStorable(a);
    if (stored === null) return null;
    assertions.push(stored);
  }

  return { ...draft, workloads, assertions };
}

/**
 * A best-effort stored Scenario used only to run the storable/readiness validators so
 * *other* field errors (e.g. an empty label) still surface while emission/
 * keyDistribution/path remain unset. The substituted values here are never persisted:
 * `toStorableScenario` (used by Apply) returns null whenever any of them was actually
 * substituted, and draft.ts's `draftCompletenessIssues` independently blocks Apply in
 * that case regardless of what this validation-only candidate reports.
 */
export function toValidationScenario(draft: DraftScenario): Scenario {
  const workloads: Workload[] = draft.workloads.map((w) => {
    const stored = draftWorkloadToStorable(w);
    if (stored) return stored;
    return {
      ...w,
      // Validation-only stand-in for an unset emission (never persisted).
      emission: draftEmissionToStorable(w.emission) ?? { mode: 'bulk', requests: 1, arrival: 'instant' },
      classes: w.classes.map((c) => ({
        ...c,
        keyDistribution: draftKeyDistributionToStorable(c.keyDistribution) ?? {
          kind: 'uniform',
          catalogSize: 1,
          hotSubset: 1,
          hotShare: 0,
        },
      })),
    };
  });

  const assertions: Assertion[] = draft.assertions.map((a) => {
    const stored = draftAssertionToStorable(a);
    if (stored) return stored;
    // stored === null only happens for an output/context subject with path === null
    // (draftAssertionSubjectToStorable's only failure case) -- narrow explicitly rather
    // than casting.
    const subject = a.subject;
    if (subject.kind === 'output') {
      return { ...a, subject: { kind: 'output', port: subject.port, path: [] } };
    }
    if (subject.kind === 'context') {
      return { ...a, subject: { kind: 'context', elementId: subject.elementId, path: [] } };
    }
    throw new Error('toValidationScenario: unexpected unset assertion subject');
  });

  return { ...draft, workloads, assertions };
}

export type { Json };
