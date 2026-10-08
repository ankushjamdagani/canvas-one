import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareScenario } from './compile';
import { buildManifest, type BuildManifestVersions } from '../manifest';
import type { AuthoredSnapshot } from './types';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');

function loadFixture(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

const VERSIONS: BuildManifestVersions = {
  compilerVersion: '0.1.0',
  runnerVersions: [
    { runnerId: 'resource-kernel', version: '0.1.0' },
    { runnerId: 'bridge', version: '0.1.0' },
  ],
};

function snapshotOf(doc: unknown, id = 'snap-1'): AuthoredSnapshot {
  return { id, document: doc as AuthoredSnapshot['document'] };
}

describe('prepareScenario: S01-S05 fixtures', () => {
  const fixtureFiles = ['s01.json', 's02.json', 's03.json', 's04.json', 's05.json'];

  for (const file of fixtureFiles) {
    it(`every scenario in ${file} is ready with the same fingerprint as buildManifest directly`, async () => {
      const doc = loadFixture(file);
      expect(doc.scenarios.length).toBeGreaterThan(0);
      for (const scenario of doc.scenarios) {
        const controller = new AbortController();
        const result = await prepareScenario(snapshotOf(doc), scenario.id, controller.signal, VERSIONS);
        const direct = await buildManifest(doc, scenario.id, VERSIONS);

        expect(direct.status).toBe('ok');
        expect(result.status).toBe('ready');
        if (result.status === 'ready' && direct.status === 'ok') {
          expect(result.fingerprint).toBe(direct.fingerprint);
          expect(result.fingerprint).toMatch(/^ss-run-v1:[0-9a-f]{64}$/);
          expect(result.manifest).toEqual(direct.manifest);
        }
      }
    });
  }
});

describe('prepareScenario: invalid storable document', () => {
  it('returns invalid with issues when the document fails storable validation', async () => {
    const doc = loadFixture('s01.json');
    const broken = structuredClone(doc);
    // Unknown property on the document root fails storable validation
    // (closed records reject unknown properties).
    broken.notARealField = true;

    const controller = new AbortController();
    const result = await prepareScenario(snapshotOf(broken), doc.scenarios[0].id, controller.signal, VERSIONS);

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('prepareScenario: not-ready scenario', () => {
  it('returns invalid with issues when the scenario fails readiness', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const broken = structuredClone(doc);
    const boundary = broken.scenarios.find((s: any) => s.id === scenarioId)!.boundaries[0];
    const srcEl = broken.elements.find((e: any) => e.id === boundary.source.elementId)!;
    const srcPort = srcEl.ports.find((p: any) => p.id === boundary.source.portId);
    if (srcPort && srcPort.channel === 'call') {
      srcPort.responseSchemaId = null;
    }

    const controller = new AbortController();
    const result = await prepareScenario(snapshotOf(broken), scenarioId, controller.signal, VERSIONS);

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('prepareScenario: cancellation', () => {
  it('returns cancelled for a pre-aborted signal', async () => {
    const doc = loadFixture('s01.json');
    const controller = new AbortController();
    controller.abort();

    const result = await prepareScenario(snapshotOf(doc), doc.scenarios[0].id, controller.signal, VERSIONS);

    expect(result.status).toBe('cancelled');
    if (result.status === 'cancelled') {
      expect(result.issues).toEqual([]);
    }
  });

  it('returns cancelled when the signal aborts between validation and the manifest build', async () => {
    const doc = loadFixture('s01.json');
    const controller = new AbortController();

    const promise = prepareScenario(snapshotOf(doc), doc.scenarios[0].id, controller.signal, VERSIONS);
    // Scheduled as a microtask: by the time buildManifest's internal awaits resolve and
    // prepareScenario's post-build signal check runs, this has already fired. No sleeps.
    queueMicrotask(() => controller.abort());

    const result = await promise;

    expect(result.status).toBe('cancelled');
  });
});
