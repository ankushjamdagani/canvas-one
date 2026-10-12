import type { RunRecord } from '../artifacts.js';
export type CsvExportOptions = { readonly run: Pick<RunRecord, 'id' | 'manifest' | 'fingerprint' | 'status' | 'provenance' | 'checks' | 'summary'>; readonly snapshotDocument?: { readonly elements: readonly { readonly id: string; readonly label: string }[] } | null };
export type CsvExportResult = { readonly csv: string; readonly fileName: string; readonly rowCount: number; readonly byteLength: number; readonly limitations: string };
