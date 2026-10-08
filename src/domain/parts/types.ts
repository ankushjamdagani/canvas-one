/**
 * Detached part content and capture preview types.
 *
 * Part content deliberately excludes documents, scenarios, runs, and history.
 */

import type {
  Connection,
  Element,
  Fixture,
  Group,
  Id,
  Note,
  PayloadSchema,
  Placement,
  Refinement,
  Relation,
} from '../studio/model';
import type { Issue } from '../studio/validate';

export type PartContent = {
  readonly schema: 'studio-part-content/1';
  readonly elements: readonly Element[];
  readonly connections: readonly Connection[];
  readonly relations: readonly Relation[];
  readonly schemas: readonly PayloadSchema[];
  readonly fixtures: readonly Fixture[];
  readonly refinements: readonly Refinement[];
  readonly view: {
    readonly placements: readonly Placement[];
    readonly groups: readonly Group[];
    readonly notes: readonly Note[];
  };
};

export type CaptureSelection = {
  readonly elementIds: readonly Id[];
  readonly noteIds: readonly Id[];
};

export type CapturePreview = {
  readonly selectedElementIds: readonly Id[];
  readonly includedElementIds: readonly Id[];
  readonly requiredSchemaIds: readonly Id[];
  readonly requiredFixtureIds: readonly Id[];
  readonly requiredRefinementIds: readonly Id[];
  readonly includedConnectionIds: readonly Id[];
  readonly includedRelationIds: readonly Id[];
  readonly excludedConnectionIds: readonly Id[];
  readonly excludedRelationIds: readonly Id[];
  readonly includedGroupIds: readonly Id[];
  readonly omittedPartialGroupIds: readonly Id[];
  readonly includedNoteIds: readonly Id[];
  readonly excludedNoteIds: readonly Id[];
  readonly notices: readonly string[];
  readonly warnings: readonly string[];
};

export type CaptureResult =
  | { readonly ok: true; readonly content: PartContent; readonly preview: CapturePreview }
  | { readonly ok: false; readonly issues: readonly Issue[] };

