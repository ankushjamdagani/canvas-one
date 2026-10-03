import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Document, RequestMeta } from './model';
import { validateDocument } from './validate';
import { buildManifest } from './manifest';

function fixture(name = 's05'): Document {
  return JSON.parse(readFileSync(`specs/revamp/fixtures/${name}.json`, 'utf8'));
}

function validationIssues(doc: unknown) {
  const result = validateDocument(doc);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected invalid document');
  return result.issues;
}

/** D53: request classes live on the out-ports that send them. */
function changeResources(doc: Document, change: (request: RequestMeta) => unknown) {
  return {
    ...doc,
    elements: doc.elements.map((element) => ({
      ...element,
      ports: element.ports.map((port) => {
        const request = (port.settings as { request?: RequestMeta } | undefined)?.request;
        if (!request) return port;
        return { ...port, settings: { ...port.settings, request: change(request) } };
      }),
    })),
  };
}

describe('resource request class labels', () => {
  it.each(['A', '😀'.repeat(60)])('accepts 1–60 Unicode code points: %s', (requestClassLabel) => {
    const doc = changeResources(fixture(), (resource) => ({ ...resource, requestClassLabel }));
    expect(validateDocument(doc).ok).toBe(true);
  });

  it.each(['', '😀'.repeat(61), 123, null])('rejects invalid labels: %s', (requestClassLabel) => {
    const doc = changeResources(fixture(), (resource) => ({ ...resource, requestClassLabel }));
    expect(validationIssues(doc).some((issue) => issue.path.at(-1) === 'requestClassLabel')).toBe(true);
  });

  it('requires the label and rejects unknown metadata keys', () => {
    const missing = changeResources(fixture(), (resource) => ({
      requestClassId: resource.requestClassId,
      operation: resource.operation,
      key: resource.key,
      tags: resource.tags,
    }));
    expect(validationIssues(missing)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing-property', path: expect.arrayContaining(['requestClassLabel']) }),
    ]));
    const extra = changeResources(fixture(), (resource) => ({ ...resource, otherLabel: 'Order' }));
    expect(validationIssues(extra)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unknown-property', path: expect.arrayContaining(['otherLabel']) }),
    ]));
  });

  it('rejects different labels for the same class across ports', () => {
    let index = 0;
    const doc = changeResources(fixture(), (resource) => ({
      ...resource, requestClassLabel: index++ === 0 ? 'Order' : 'Different',
    }));
    expect(index).toBeGreaterThanOrEqual(2);
    expect(validationIssues(doc)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'structural-rule', path: expect.arrayContaining(['requestClassLabel']) }),
    ]));
  });

  it.each(['s02', 's05', 'combined'])('excludes labels from every %s manifest and fingerprint', async (name) => {
    const doc = fixture(name);
    const renamed = validateDocument(changeResources(doc, (resource) => ({ ...resource, requestClassLabel: 'Renamed' })));
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) throw new Error('Renamed fixture is invalid');
    const versions = { compilerVersion: '0.1.0', runnerVersions: [{ runnerId: 'bridge', version: '0.1.0' }] };
    for (const scenario of doc.scenarios) {
      const original = await buildManifest(doc, scenario.id, versions);
      const changed = await buildManifest(renamed.document, scenario.id, versions);
      expect(original.status).toBe('ok');
      expect(changed.status).toBe('ok');
      if (original.status !== 'ok' || changed.status !== 'ok') throw new Error('Manifest did not build');
      expect(changed.manifest).toEqual(original.manifest);
      expect(changed.fingerprint).toBe(original.fingerprint);
      expect(JSON.stringify(changed.manifest)).not.toContain('requestClassLabel');
    }
  });
});
