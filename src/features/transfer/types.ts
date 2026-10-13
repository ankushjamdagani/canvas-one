/**
 * Types shared by the project JSON transfer and the SVG, PNG, Mermaid and CSV exporters.
 */

import type { Id } from '../../domain/studio/model';
import type { Issue } from '../../domain/studio/validate';
import type { FileTokenRegistry } from '../../persistence/studio/file-tokens';
import type { LocalRepository } from '../../persistence/studio/repository';
import type {
  Actor,
  AppliedResult,
  StudioRepository,
} from '../../persistence/studio/types';

// ============================================================================
// JSON Transfer Types
// ============================================================================

export type RepositoryWithFileTokens = StudioRepository & {
  readonly fileTokens: FileTokenRegistry;
};

export type ExportProjectJsonParams = {
  readonly repository: StudioRepository | LocalRepository;
  readonly projectId: Id;
  readonly expectedProjectRevision: number;
  readonly mintId: () => Id;
};

export type ExportProjectJsonSuccess = {
  readonly ok: true;
  readonly fileName: string;
  readonly blob: Blob;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly limitations: string;
};

export type ExportProjectJsonFailure = {
  readonly ok: false;
  readonly kind: 'not-found' | 'stale' | 'limit' | 'failed' | 'invalid';
  readonly message: string;
  readonly issues?: readonly Issue[];
};

export type ExportProjectJsonResult = ExportProjectJsonSuccess | ExportProjectJsonFailure;

export type ImportProjectJsonParams = {
  readonly repository: StudioRepository | LocalRepository | RepositoryWithFileTokens;
  readonly fileTokens?: FileTokenRegistry;
  readonly file: File | Blob | Uint8Array;
  readonly mintId: () => Id;
  readonly actor: Actor;
};

export type ImportProjectJsonSuccess = {
  readonly ok: true;
  readonly projectId: Id;
  readonly result: AppliedResult;
};

export type ImportProjectJsonFailure =
  | {
      readonly ok: false;
      readonly kind: 'unsupported-version';
      readonly message: string;
      readonly issues: readonly Issue[];
    }
  | {
      readonly ok: false;
      readonly kind: 'invalid';
      readonly issues: readonly Issue[];
      readonly message?: string;
    }
  | {
      readonly ok: false;
      readonly kind: 'too-large';
      readonly message: string;
      readonly issues: readonly Issue[];
    }
  | {
      readonly ok: false;
      readonly kind: 'quota';
      readonly message: string;
      readonly issues: readonly Issue[];
    }
  | {
      readonly ok: false;
      readonly kind: 'failed';
      readonly message: string;
      readonly issues: readonly Issue[];
    };

export type ImportProjectJsonResult = ImportProjectJsonSuccess | ImportProjectJsonFailure;

// ============================================================================
// Diagram (SVG & PNG) Transfer Types
// ============================================================================

export type DiagramExportFormat = 'svg' | 'png';

export type { PngDimensions } from '@canvas-one/whiteboard/export/raster';

export type { CanvasContext2DLike, CanvasLike, CanvasFactory, ImageLoader, RenderPngOptions, RasterizationProvider } from '@canvas-one/whiteboard/browser/raster';

// ============================================================================
// Mermaid Export Types
// ============================================================================

export type { MermaidExportResult } from '@canvas-one/system-design/export/mermaid-types';

// ============================================================================
// CSV Export Types
// ============================================================================

export type { CsvExportOptions } from '@canvas-one/simulation-system-design/export/csv-types';

export type { CsvExportResult } from '@canvas-one/simulation-system-design/export/csv-types';

// ============================================================================
// Limitations
// ============================================================================

export type ExportFormat = 'json' | 'svg' | 'png' | 'mermaid' | 'csv';
