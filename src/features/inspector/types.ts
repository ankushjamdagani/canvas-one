/** UI adds its own optional presentation metadata to package-owned behavior contracts. */
export type { InspectorTargetKind, DraftTarget, FieldKind, FieldOption, FieldParseResult, FieldSpec, DraftStatus, ValidateDraftResult, DraftSession, DraftApplyOutcome, ApplyDraftResult } from '@canvas-one/system-design/authoring/inspector/types';
import type { DraftHandle as SemanticDraftHandle } from '@canvas-one/system-design/authoring/inspector/types';
import type { CatalogLayer } from '../workspace/projection';
export type DraftHandle = SemanticDraftHandle & {
  readonly layer?: CatalogLayer | null;
  readonly stripeColor?: string | null;
};
export type { InspectorFieldFactory, InspectorDraftOptions } from '@canvas-one/system-design/authoring/inspector/types';
