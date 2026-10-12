import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('dexie', () => { throw new Error('Archive codec imported Dexie'); });
vi.mock('react', () => { throw new Error('Archive codec imported React'); });
import { computeArchiveSnapshotId, exportProjectArchive, validatePortableBundle, type ArchiveReadSnapshot } from '@canvas-one/simulation-system-design/archive';
import { DEFAULT_BUILD_VERSIONS } from '@canvas-one/simulation-system-design/artifacts';
import { runScenario } from '@canvas-one/simulation-system-design/runner/scenario-runner';
import { buildManifest } from '@canvas-one/system-design/studio/manifest';
import type { Document } from '@canvas-one/system-design/studio/model';

describe('public portable archive codec', () => {
  it('preserves authored hashes, history IDs and run provenance through a headless consistent-reader export', async () => {
    const document = JSON.parse(readFileSync('src/features/entry/examples/s01.json', 'utf8')) as Document;
    const snapshotId = await computeArchiveSnapshotId(document);
    const projectId = '00000000-0000-4000-8000-000000000001';
    const branchId = '00000000-0000-4000-8000-000000000002';
    const commitId = '00000000-0000-4000-8000-000000000003';
    const runId = '00000000-0000-4000-8000-000000000004';
    const manifest = await buildManifest(document, document.scenarios[0].id, DEFAULT_BUILD_VERSIONS);
    if (manifest.status !== 'ok') throw new Error('Fixture manifest must build');
    const terminal = await runScenario(document, document.scenarios[0].id, runId);
    const actor = { actorId: 'human', kind: 'local-human' as const, displayName: 'Author' };
    const snapshot: ArchiveReadSnapshot = {
      project: { id: projectId, title: 'Archive', createdAt: 0, updatedAt: 1, mainBranchId: branchId, initialSnapshotId: snapshotId },
      branches: [{ projectId, id: branchId, label: 'Main', state: 'open', headCommitId: commitId, workingSnapshotId: snapshotId, workingRevision: 3, createdAt: 0 }],
      snapshots: [{ projectId, id: snapshotId, document }],
      commits: [{ projectId, id: commitId, snapshotId, parentIds: [], evidence: [{ scenarioId: document.scenarios[0].id, runId, fingerprint: manifest.fingerprint }], actor, createdAt: 0, message: 'Initial architecture' }],
      publications: [], checkpoints: [], parts: [],
      runs: [{ projectId, id: runId, snapshotId, manifest: manifest.manifest, fingerprint: manifest.fingerprint, status: terminal.status, provenance: 'local', checks: terminal.checks, summary: terminal.summary, traceState: 'complete', createdAt: 0, completedAt: 1 }],
    };
    const read = vi.fn(async () => ({ status: 'read' as const, data: snapshot }));
    const result = await exportProjectArchive({ projectId, expectedProjectRevision: 3 }, { reader: { read }, mintId: () => 'download', mapError: () => ({ status: 'failed', code: 'unavailable', issues: [] }) });
    expect(read).toHaveBeenCalledWith({ projectId, expectedProjectRevision: 3 });
    if (result.status !== 'done') throw new Error('Fixture archive must export');
    const validation = await validatePortableBundle(result.bytes);
    if (!validation.ok) throw new Error(JSON.stringify(validation.issues));
    expect(validation.bundle.commits[0]).toMatchObject({ id: commitId, snapshotId, evidence: [{ runId, fingerprint: manifest.fingerprint }] });
    expect(validation.bundle.snapshots[0].document).toEqual(document);
    expect(validation.bundle.runs[0]).toMatchObject({ id: runId, provenance: 'local', traceState: 'not-saved' });
    expect(snapshot.runs[0].traceState).toBe('complete');
    expect(validation.bundle.commits[0]).not.toHaveProperty('projectId');
    const envelope = JSON.parse(new TextDecoder().decode(result.bytes));
    for (const version of [7, 8, 10]) {
      const invalid = await validatePortableBundle(new TextEncoder().encode(JSON.stringify({ ...envelope, version })));
      expect(invalid).toMatchObject({ ok: false, kind: 'unsupported-version' });
    }
  });

  it('returns stale reads without encoding or minting a download', async () => {
    const mintId = vi.fn(() => 'download');
    const result = await exportProjectArchive({ projectId: 'project', expectedProjectRevision: 1 }, { reader: { read: async () => ({ status: 'stale', scope: 'project', expected: 1, actual: 2 }) }, mintId, mapError: () => ({ status: 'failed', code: 'unavailable', issues: [] }) });
    expect(result).toEqual({ status: 'stale', scope: 'project', expected: 1, actual: 2 });
    expect(mintId).not.toHaveBeenCalled();
  });
});
