/**
 * Transfer and Exporters Types (RV-10a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/parts-and-export.md ("JSON, images and files", "CSV v1", "Mermaid v1")
 * - specs/revamp/requirements.md (R10: Entry and transfer)
 * - specs/revamp/contracts/storage.md (§4 portable bundle, §5 repository API, §6 ceilings)
 * - specs/revamp/decisions.md (D12, D19, D37, D42)
 */

import type { Document, Id } from '../../domain/studio/model';
import type { ElementMetric } from '../../domain/studio/runner/types';
import type { Issue } from '../../domain/studio/validate';
import type { FileTokenRegistry } from '../../persistence/studio/file-tokens';
import type { LocalRepository } from '../../persistence/studio/repository';
import type {
  Actor,
  AppliedResult,
  ProjectBundle,
  RunRecord,
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

export type PngDimensions = {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
};

export type CanvasContext2DLike = {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
};

export type CanvasLike = {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasContext2DLike | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string): void;
  convertToBlob?(options?: { type?: string }): Promise<Blob>;
};

export type CanvasFactory = (width: number, height: number) => CanvasLike;

export type ImageLoader = (url: string) => Promise<unknown>;

export type RenderPngOptions = {
  readonly canvasFactory?: CanvasFactory;
  readonly imageLoader?: ImageLoader;
};

// ============================================================================
// Mermaid Export Types
// ============================================================================

export type MermaidExportResult = {
  readonly text: string;
  readonly fileName: string;
  readonly limitations: string;
};

// ============================================================================
// CSV Export Types
// ============================================================================

export type CsvExportOptions = {
  readonly run: RunRecord;
  readonly snapshotDocument?: Document | null;
};

export type CsvExportResult = {
  readonly csv: string;
  readonly fileName: string;
  readonly rowCount: number;
  readonly byteLength: number;
  readonly limitations: string;
};

// ============================================================================
// Limitations
// ============================================================================

export type ExportFormat = 'json' | 'svg' | 'png' | 'mermaid' | 'csv';
