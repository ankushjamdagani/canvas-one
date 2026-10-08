/**
 * Tests for the exporter limitations texts.
 */

import { describe, expect, it } from 'vitest';
import {
  CSV_EXPORT_LIMITATIONS,
  JSON_EXPORT_LIMITATIONS,
  MERMAID_EXPORT_LIMITATIONS,
  PNG_EXPORT_LIMITATIONS,
  SVG_EXPORT_LIMITATIONS,
  getExportLimitations,
} from './limitations';

describe('Exporter Limitations (getExportLimitations)', () => {
  it('returns appropriate limitations text for each export format', () => {
    expect(getExportLimitations('json')).toBe(JSON_EXPORT_LIMITATIONS);
    expect(getExportLimitations('json')).toMatch(/transient preferences/i);

    expect(getExportLimitations('svg')).toBe(SVG_EXPORT_LIMITATIONS);
    expect(getExportLimitations('svg')).toContain('Vector rendition');

    expect(getExportLimitations('png')).toBe(PNG_EXPORT_LIMITATIONS);
    expect(getExportLimitations('png')).toContain('8,192 px');

    expect(getExportLimitations('mermaid')).toBe(MERMAID_EXPORT_LIMITATIONS);
    expect(getExportLimitations('mermaid')).toContain('Lossy diagram');

    expect(getExportLimitations('csv')).toBe(CSV_EXPORT_LIMITATIONS);
    expect(getExportLimitations('csv')).toContain('Spreadsheet-safe');
  });
});
