import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest, type BuildManifestVersions } from './manifest';
import type { Document } from './model';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');

// Loaded as `any` (mirroring validate.test.ts / readiness.test.ts / closure.test.ts
// conventions) so mutation tests below can freely edit nested fields without fighting
// `Document`'s `readonly` structural types; `buildManifest` itself still requires and is
// exercised against a properly-typed `Document`.
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

/**
 * Deeply rebuilds every plain object with its keys inserted in reverse order, to
 * exercise "reordered object keys in the doc" independently of the builder: since
 * canonical-json-v1 sorts keys, and this builder reads fields by name (never by
 * enumeration order), a manifest/fingerprint built from a key-shuffled clone must be
 * identical to one built from the original.
 */
function shuffleKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => shuffleKeys(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, shuffleKeys(v)] as const)
      .reverse();
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = v;
    return out as T;
  }
  return value;
}

describe('buildManifest reference fixtures', () => {
  const fixtureFiles = ['s01.json', 's02.json', 's03.json', 's04.json', 's05.json'];

  for (const file of fixtureFiles) {
    it(`every scenario in ${file} yields a valid ss-run-v1 fingerprint`, async () => {
      const doc = loadFixture(file);
      expect(doc.scenarios.length).toBeGreaterThan(0);
      for (const scenario of doc.scenarios) {
        const result = await buildManifest(doc, scenario.id, VERSIONS);
        if (result.status !== 'ok') {
          throw new Error(`Scenario ${scenario.id} in ${file} did not build: ${JSON.stringify(result)}`);
        }
        expect(result.status).toBe('ok');
        expect(result.fingerprint).toMatch(/^ss-run-v1:[0-9a-f]{64}$/);
      }
    });
  }
});

describe('buildManifest golden vectors: equal fingerprint', () => {
  it('excludes custom visual content and opaque authored extensions from execution fingerprints', async () => {
    const doc = loadFixture('s01.json');
    const before = await buildManifest(doc, doc.scenarios[0].id, VERSIONS);
    const changed = structuredClone(doc);
    changed.elements[0].component = {type: 'example/custom', data: {text: 'Visual explanation'}, extensions: {}};
    changed.extensions = {'unknown/provider': {version: '9.0.0', data: {opaque: true}}};
    expect(await buildManifest(changed, changed.scenarios[0].id, VERSIONS)).toEqual(before);
    changed.elements[0].component.data.text = 'Another explanation';
    expect(await buildManifest(changed, changed.scenarios[0].id, VERSIONS)).toEqual(before);
  });
  it('is unaffected by reordered object keys throughout the document', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const a = await buildManifest(doc, scenarioId, VERSIONS);
    const b = await buildManifest(shuffleKeys(doc), scenarioId, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).toBe(a.fingerprint);
    }
  });

  it('is unaffected by reordered entity storage (elements, connections, schemas, fixtures shuffled)', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const a = await buildManifest(doc, scenarioId, VERSIONS);

    const reordered = structuredClone(doc);
    reordered.elements = [...reordered.elements].reverse();
    reordered.connections = [...reordered.connections].reverse();
    reordered.schemas = [...reordered.schemas].reverse();
    reordered.fixtures = [...reordered.fixtures].reverse();

    const b = await buildManifest(reordered, scenarioId, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).toBe(a.fingerprint);
    }
  });

  it('is unaffected by reordered scenario entryPorts (a set, user decision 2026-09-29)', async () => {
    const doc = loadFixture('s01.json');
    const scenario = doc.scenarios.find((s: { entryPorts: unknown[] }) => s.entryPorts.length > 1);
    expect(scenario).toBeDefined();
    const a = await buildManifest(doc, scenario.id, VERSIONS);

    const reordered = structuredClone(doc);
    const target = reordered.scenarios.find((s: { id: string }) => s.id === scenario.id);
    target.entryPorts = [...target.entryPorts].reverse();

    const b = await buildManifest(reordered, scenario.id, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).toBe(a.fingerprint);
      const endpoints = a.manifest.scenario.entryPorts.map((e) => `${e.elementId}\u0000${e.portId}`);
      expect(endpoints).toEqual([...endpoints].sort());
    }
  });

  it('is unaffected by presentation-only changes (labels, descriptions, views/placements, visualKind)', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const a = await buildManifest(doc, scenarioId, VERSIONS);

    const presentational = structuredClone(doc);
    (presentational as { title: string }).title = 'A completely different title';
    presentational.elements = presentational.elements.map((e: any) => ({
      ...e,
      label: `${e.label} (renamed)`,
      description: 'A different description entirely',
      visualKind: e.visualKind === 'custom' ? 'process' : 'custom',
    }));
    presentational.schemas = presentational.schemas.map((s: any) => ({ ...s, label: `${s.label} (renamed)` }));
    presentational.views = presentational.views.map((v: any) => ({
      ...v,
      label: `${v.label} (renamed)`,
      placements: v.placements.map((p: any) => ({ ...p, x: p.x + 1000, y: p.y + 1000, width: p.width + 50, expanded: !p.expanded })),
    }));

    const b = await buildManifest(presentational, scenarioId, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).toBe(a.fingerprint);
    }
  });

  it('is unaffected when only an assertion label changes', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const a = await buildManifest(doc, scenarioId, VERSIONS);

    const relabeled = structuredClone(doc);
    const sc = relabeled.scenarios.find((s: any) => s.id === scenarioId)!;
    sc.assertions = sc.assertions.map((assn: any) => ({ ...assn, label: `${assn.label} (renamed)` }));

    const b = await buildManifest(relabeled, scenarioId, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).toBe(a.fingerprint);
    }
  });

  it('is unaffected when only an assumption description changes', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;

    const withAssumption = structuredClone(doc);
    const sc = withAssumption.scenarios.find((s: any) => s.id === scenarioId)!;
    sc.assumptions = [
      { id: '90000000-0000-4000-8000-000000000001', key: 'retry-budget', value: 3, source: 'author', description: 'initial guess' },
    ];
    const a = await buildManifest(withAssumption, scenarioId, VERSIONS);

    const redescribed = structuredClone(withAssumption);
    const sc2 = redescribed.scenarios.find((s: any) => s.id === scenarioId)!;
    sc2.assumptions = [{ ...sc2.assumptions[0], id: '90000000-0000-4000-8000-000000000002', description: 'measured from prod' }];

    const b = await buildManifest(redescribed, scenarioId, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).toBe(a.fingerprint);
    }
  });
});

describe('buildManifest golden vectors: different fingerprint', () => {
  it('differs when scenario inputs are reordered', async () => {
    const doc = loadFixture('s01.json');
    const scenario = doc.scenarios.find((s: any) => s.inputs.length >= 2)!;
    expect(scenario).toBeDefined();
    const a = await buildManifest(doc, scenario.id, VERSIONS);

    const reordered = structuredClone(doc);
    const sc = reordered.scenarios.find((s: any) => s.id === scenario.id)!;
    sc.inputs = [...sc.inputs].reverse();

    const b = await buildManifest(reordered, scenario.id, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).not.toBe(a.fingerprint);
    }
  });

  it('differs when a connection latencyMs changes', async () => {
    const doc = loadFixture('s04.json');
    const scenario = doc.scenarios[0];
    const a = await buildManifest(doc, scenario.id, VERSIONS);

    const changed = structuredClone(doc);
    const conn = changed.connections.find((c: any) => c.kind === 'call')!;
    (conn.config as { latencyMs: number }).latencyMs = 999;

    const b = await buildManifest(changed, scenario.id, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).not.toBe(a.fingerprint);
    }
  });

  it('differs when a behavior field changes (a machine effect literal value)', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const a = await buildManifest(doc, scenarioId, VERSIONS);

    const changed = structuredClone(doc);
    const el = changed.elements.find((e: any) => e.behavior.kind === 'machine')!;
    const behavior = el.behavior;
    const emit = behavior.transitions[0].effects.find((eff: any) => eff.kind === 'emit');
    const paymentField = emit.value.fields.find((f: any) => f.key === 'payment')!;
    paymentField.value.value = 'deny';

    const b = await buildManifest(changed, scenarioId, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).not.toBe(a.fingerprint);
    }
  });

  it('differs when an assertion expected value changes', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const a = await buildManifest(doc, scenarioId, VERSIONS);

    const changed = structuredClone(doc);
    const sc = changed.scenarios.find((s: any) => s.id === scenarioId)!;
    sc.assertions = sc.assertions.map((assn: any, i: number) => (i === 0 ? { ...assn, expected: 1 } : assn));

    const b = await buildManifest(changed, scenarioId, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).not.toBe(a.fingerprint);
    }
  });

  it('differs when an assumption value or source changes', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const base = structuredClone(doc);
    const sc = base.scenarios.find((s: any) => s.id === scenarioId)!;
    sc.assumptions = [
      { id: '90000000-0000-4000-8000-000000000003', key: 'retry-budget', value: 3, source: 'author', description: 'x' },
    ];
    const a = await buildManifest(base, scenarioId, VERSIONS);

    const valueChanged = structuredClone(base);
    const sc1 = valueChanged.scenarios.find((s: any) => s.id === scenarioId)!;
    sc1.assumptions = [{ ...sc1.assumptions[0], value: 5 }];
    const bValue = await buildManifest(valueChanged, scenarioId, VERSIONS);

    const sourceChanged = structuredClone(base);
    const sc2 = sourceChanged.scenarios.find((s: any) => s.id === scenarioId)!;
    sc2.assumptions = [{ ...sc2.assumptions[0], source: 'measured' }];
    const bSource = await buildManifest(sourceChanged, scenarioId, VERSIONS);

    expect(a.status).toBe('ok');
    expect(bValue.status).toBe('ok');
    expect(bSource.status).toBe('ok');
    if (a.status === 'ok' && bValue.status === 'ok' && bSource.status === 'ok') {
      expect(bValue.fingerprint).not.toBe(a.fingerprint);
      expect(bSource.fingerprint).not.toBe(a.fingerprint);
    }
  });

  it('differs when the seed changes', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const a = await buildManifest(doc, scenarioId, VERSIONS);

    const changed = structuredClone(doc);
    const sc = changed.scenarios.find((s: any) => s.id === scenarioId)!;
    (sc as { seed: number }).seed = sc.seed + 1;

    const b = await buildManifest(changed, scenarioId, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).not.toBe(a.fingerprint);
    }
  });

  it('differs when budgets change', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const a = await buildManifest(doc, scenarioId, VERSIONS);

    const changed = structuredClone(doc);
    const sc = changed.scenarios.find((s: any) => s.id === scenarioId)!;
    sc.budgets = { ...sc.budgets, maxEvents: sc.budgets.maxEvents - 1 };

    const b = await buildManifest(changed, scenarioId, VERSIONS);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status === 'ok' && b.status === 'ok') {
      expect(b.fingerprint).not.toBe(a.fingerprint);
    }
  });
});

describe('buildManifest: hash unavailable', () => {
  it("returns 'identity-unavailable' when crypto.subtle.digest is stubbed to throw, with no weaker fallback hash", async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const originalDigest = globalThis.crypto.subtle.digest;
    globalThis.crypto.subtle.digest = (() => {
      throw new Error('simulated Web Crypto failure');
    }) as typeof globalThis.crypto.subtle.digest;

    try {
      const result = await buildManifest(doc, scenarioId, VERSIONS);
      expect(result).toEqual({ status: 'identity-unavailable' });
    } finally {
      globalThis.crypto.subtle.digest = originalDigest;
    }
  });
});

describe('buildManifest: readiness propagation', () => {
  it("returns 'not-ready' with issues when the scenario fails readiness", async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const broken = structuredClone(doc);
    // Break a call port's response schema requirement to force a readiness rejection
    // rather than a closure/compiler failure.
    const boundary = broken.scenarios.find((s: any) => s.id === scenarioId)!.boundaries[0];
    const srcEl = broken.elements.find((e: any) => e.id === boundary.source.elementId)!;
    const srcPort = srcEl.ports.find((p: any) => p.id === boundary.source.portId);
    if (srcPort && srcPort.channel === 'call') {
      (srcPort as { responseSchemaId: string | null }).responseSchemaId = null;
    }

    const result = await buildManifest(broken, scenarioId, VERSIONS);
    expect(result.status).toBe('not-ready');
    if (result.status === 'not-ready') {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('buildManifest: coverage test (closed key sets)', () => {
  afterEach(() => {
    // no shared mutable state between these tests beyond fresh clones; kept for symmetry.
  });

  it('throws when an element carries an unclassified field not in the projection inventory', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const mutated = structuredClone(doc) as unknown as { elements: Record<string, unknown>[] };
    mutated.elements[0].syntheticUnclassifiedField = 'not in the inventory yet';

    await expect(buildManifest(mutated as unknown as Document, scenarioId, VERSIONS)).rejects.toThrow(/unclassified field/);
  });

  it('throws when a connection carries an unclassified field', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const mutated = structuredClone(doc) as unknown as { connections: Record<string, unknown>[] };
    if (mutated.connections.length > 0) {
      mutated.connections[0].syntheticUnclassifiedField = 'nope';
      await expect(buildManifest(mutated as unknown as Document, scenarioId, VERSIONS)).rejects.toThrow(/unclassified field/);
    }
  });

  it('throws when the scenario record itself carries an unclassified field', async () => {
    const doc = loadFixture('s01.json');
    const scenarioId = doc.scenarios[0].id;
    const mutated = structuredClone(doc) as unknown as { scenarios: Record<string, unknown>[] };
    const sc = mutated.scenarios.find((s) => s.id === scenarioId)!;
    sc.syntheticUnclassifiedField = 'nope';

    await expect(buildManifest(mutated as unknown as Document, scenarioId, VERSIONS)).rejects.toThrow(/unclassified field/);
  });

  it('once a field is classified (kept as E), changing only that field changes the fingerprint', async () => {
    // Demonstrates the flip side of the coverage test: a field this builder already
    // classifies as E (kept) — here Connection.config.latencyMs — changes the
    // fingerprint when it changes, and a field classified as A (dropped) — here
    // Element.label — does not. Both are exercised as dedicated golden vectors
    // above; this test names the pairing explicitly for the coverage requirement.
    const doc = loadFixture('s04.json');
    const scenario = doc.scenarios[0];
    const a = await buildManifest(doc, scenario.id, VERSIONS);

    const eChanged = structuredClone(doc);
    const conn = eChanged.connections.find((c: any) => c.kind === 'call')!;
    (conn.config as { latencyMs: number }).latencyMs += 1;
    const bE = await buildManifest(eChanged, scenario.id, VERSIONS);

    const aChanged = structuredClone(doc);
    aChanged.elements[0].label = `${aChanged.elements[0].label} (renamed)`;
    const bA = await buildManifest(aChanged, scenario.id, VERSIONS);

    expect(a.status).toBe('ok');
    expect(bE.status).toBe('ok');
    expect(bA.status).toBe('ok');
    if (a.status === 'ok' && bE.status === 'ok' && bA.status === 'ok') {
      expect(bE.fingerprint).not.toBe(a.fingerprint);
      expect(bA.fingerprint).toBe(a.fingerprint);
    }
  });
});
