/**
 * Tests for JSON Export and Import flows.
 *
 * Verification:
 * - JSON export -> import round trip on S01-S05 fixture projects (fake-indexeddb)
 * - Byte-identical export twice
 * - Unsupported v7/v8 files (clearly state "made with the old app, not supported")
 * - Oversize file cap checked before reading
 * - Corrupted hash rejection
 * - mintId required everywhere
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { REFERENCE_EXAMPLES } from '../entry/fixtures';
import { createStudioDatabase, DB_NAME } from '../../persistence/studio/db';
import { LocalRepository } from '../../persistence/studio/repository';
import type { Actor, ProjectCreateCommand } from '../../persistence/studio/types';
import { exportProjectJson, importProjectJson } from './json-transfer';

const testActor: Actor = {
  actorId: 'test-user-1',
  kind: 'local-human',
  displayName: 'Test Operator',
};

function createTestRepo(): {
  repo: LocalRepository;
  db: ReturnType<typeof createStudioDatabase>;
} {
  const dbName = `${DB_NAME}-transfer-${crypto.randomUUID()}`;
  const db = createStudioDatabase(dbName);
  const repo = new LocalRepository(db, { mintId: () => crypto.randomUUID() });
  return { repo, db };
}

describe('JSON Transfer (exportProjectJson & importProjectJson)', () => {
  it('requires mintId for exportProjectJson', async () => {
    const { repo, db } = createTestRepo();
    const res = await exportProjectJson({
      repository: repo,
      projectId: crypto.randomUUID(),
      expectedProjectRevision: 0,
      mintId: undefined as any,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('invalid');
      expect(res.message).toContain('mintId');
    }
    db.close();
  });

  it('requires mintId for importProjectJson', async () => {
    const { repo, db } = createTestRepo();
    const dummyBlob = new Blob(['{}'], { type: 'application/json' });
    const res = await importProjectJson({
      repository: repo,
      file: dummyBlob,
      mintId: undefined as any,
      actor: testActor,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('invalid');
    }
    db.close();
  });

  it('performs export -> import round trip on S01–S05 fixture projects in fake-indexeddb', async () => {
    for (const example of REFERENCE_EXAMPLES) {
      const { repo, db } = createTestRepo();
      const projectId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();

      const createCmd: ProjectCreateCommand = {
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: example.title,
          initialDocument: example.fixture,
          mainBranchId,
          draftBranchId,
        },
      };
      const createRes = await repo.execute(createCmd);
      expect(createRes.status).toBe('applied');

      const project = (await repo.loadProject(projectId))!;
      expect(project).toBeDefined();

      // Export
      const exportRes = await exportProjectJson({
        repository: repo,
        projectId,
        expectedProjectRevision: project.revision,
        mintId: () => crypto.randomUUID(),
      });

      expect(exportRes.ok).toBe(true);
      if (!exportRes.ok) throw new Error('Export failed');

      expect(exportRes.fileName).toMatch(/\.system-studio\.json$/);
      expect(exportRes.blob).toBeInstanceOf(Blob);
      expect(exportRes.bytes.byteLength).toBeGreaterThan(0);
      expect(exportRes.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(exportRes.limitations).toContain('Lossless');

      // Re-import into a fresh project namespace
      const importRes = await importProjectJson({
        repository: repo,
        file: exportRes.blob,
        mintId: () => crypto.randomUUID(),
        actor: testActor,
      });

      expect(importRes.ok).toBe(true);
      if (!importRes.ok) throw new Error('Import failed');

      const newProjectId = importRes.projectId;
      expect(newProjectId).not.toBe(projectId);

      const importedProject = await repo.loadProject(newProjectId);
      expect(importedProject).toBeDefined();
      expect(importedProject!.title).toBe(example.title);
      expect(importedProject!.importSourceId).toBe(projectId);
      expect(importedProject!.revision).toBe(0);

      // Verify reference integrity of imported project
      const integrity = await repo.verifyReferenceIntegrity(newProjectId);
      expect(integrity).toEqual({ ok: true });

      db.close();
    }
  });

  it('produces byte-identical export twice for the same project', async () => {
    const { repo, db } = createTestRepo();
    const example = REFERENCE_EXAMPLES[0];
    const projectId = crypto.randomUUID();

    await repo.execute({
      commandId: 'project.create',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: {
        newProjectId: projectId,
        title: example.title,
        initialDocument: example.fixture,
        mainBranchId: crypto.randomUUID(),
        draftBranchId: crypto.randomUUID(),
      },
    });

    const project = (await repo.loadProject(projectId))!;

    const export1 = await exportProjectJson({
      repository: repo,
      projectId,
      expectedProjectRevision: project.revision,
      mintId: () => crypto.randomUUID(),
    });

    const export2 = await exportProjectJson({
      repository: repo,
      projectId,
      expectedProjectRevision: project.revision,
      mintId: () => crypto.randomUUID(),
    });

    expect(export1.ok).toBe(true);
    expect(export2.ok).toBe(true);
    if (!export1.ok || !export2.ok) throw new Error('Export failed');

    expect(Buffer.from(export1.bytes)).toEqual(Buffer.from(export2.bytes));
    expect(export1.sha256).toBe(export2.sha256);
    expect(export1.fileName).toBe(export2.fileName);

    db.close();
  });

  it('rejects unsupported v7 and v8 files with a clear "made with the old app, not supported" message', async () => {
    const { repo, db } = createTestRepo();

    const v7Payload = JSON.stringify({
      format: 'system-studio',
      version: 7,
      project: { id: crypto.randomUUID(), title: 'Old v7 project' },
    });
    const v7Blob = new Blob([v7Payload], { type: 'application/json' });

    const res7 = await importProjectJson({
      repository: repo,
      file: v7Blob,
      mintId: () => crypto.randomUUID(),
      actor: testActor,
    });

    expect(res7.ok).toBe(false);
    if (!res7.ok) {
      expect(res7.kind).toBe('unsupported-version');
      expect(res7.message).toContain('made with the old app, not supported');
    }

    const v8Payload = JSON.stringify({
      format: 'system-studio',
      version: 8,
      project: { id: crypto.randomUUID(), title: 'Old v8 project' },
    });
    const v8Blob = new Blob([v8Payload], { type: 'application/json' });

    const res8 = await importProjectJson({
      repository: repo,
      file: v8Blob,
      mintId: () => crypto.randomUUID(),
      actor: testActor,
    });

    expect(res8.ok).toBe(false);
    if (!res8.ok) {
      expect(res8.kind).toBe('unsupported-version');
      expect(res8.message).toContain('made with the old app, not supported');
    }

    db.close();
  });

  it('rejects oversize files (> 64 MiB) before reading into memory', async () => {
    const { repo, db } = createTestRepo();

    // Create a mock File/Blob with size > 64 MiB
    const fakeOversizeFile = {
      size: 65 * 1024 * 1024,
      type: 'application/json',
      arrayBuffer: async () => {
        throw new Error('arrayBuffer should NOT have been called due to early byte cap check');
      },
    } as unknown as File;

    const res = await importProjectJson({
      repository: repo,
      file: fakeOversizeFile,
      mintId: () => crypto.randomUUID(),
      actor: testActor,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('too-large');
      expect(res.message).toContain('64 MiB');
    }

    db.close();
  });

  it('rejects corrupted snapshot content hash as typed invalid', async () => {
    const { repo, db } = createTestRepo();
    const example = REFERENCE_EXAMPLES[0];
    const projectId = crypto.randomUUID();

    await repo.execute({
      commandId: 'project.create',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: {
        newProjectId: projectId,
        title: example.title,
        initialDocument: example.fixture,
        mainBranchId: crypto.randomUUID(),
        draftBranchId: crypto.randomUUID(),
      },
    });

    const project = (await repo.loadProject(projectId))!;
    const exportRes = await exportProjectJson({
      repository: repo,
      projectId,
      expectedProjectRevision: project.revision,
      mintId: () => crypto.randomUUID(),
    });
    expect(exportRes.ok).toBe(true);
    if (!exportRes.ok) throw new Error('export failed');

    const envelope = JSON.parse(new TextDecoder().decode(exportRes.bytes));
    // Corrupt snapshot id
    envelope.project.snapshots[0].id = '0'.repeat(64);

    const corruptedBlob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
    const importRes = await importProjectJson({
      repository: repo,
      file: corruptedBlob,
      mintId: () => crypto.randomUUID(),
      actor: testActor,
    });

    expect(importRes.ok).toBe(false);
    if (!importRes.ok) {
      expect(importRes.kind).toBe('invalid');
      expect(importRes.issues.length).toBeGreaterThan(0);
      expect(importRes.issues.some((iss) => iss.message.includes('does not match its recomputed content hash'))).toBe(true);
    }

    db.close();
  });

  it('rejects import with typed failure when repository lacks FileTokenRegistry and none is provided', async () => {
    const { repo, db } = createTestRepo();
    const example = REFERENCE_EXAMPLES[0];
    const projectId = crypto.randomUUID();

    await repo.execute({
      commandId: 'project.create',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: {
        newProjectId: projectId,
        title: example.title,
        initialDocument: example.fixture,
        mainBranchId: crypto.randomUUID(),
        draftBranchId: crypto.randomUUID(),
      },
    });

    const project = (await repo.loadProject(projectId))!;
    const exportRes = await exportProjectJson({
      repository: repo,
      projectId,
      expectedProjectRevision: project.revision,
      mintId: () => crypto.randomUUID(),
    });
    expect(exportRes.ok).toBe(true);
    if (!exportRes.ok) throw new Error('export failed');

    // StudioRepository without fileTokens property
    const customRepo = new Proxy(repo, {
      has(target, prop) {
        if (prop === 'fileTokens') return false;
        return Reflect.has(target, prop);
      },
      get(target, prop) {
        if (prop === 'fileTokens') return undefined;
        const val = Reflect.get(target, prop, target);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });

    const importRes = await importProjectJson({
      repository: customRepo,
      file: exportRes.blob,
      mintId: () => crypto.randomUUID(),
      actor: testActor,
    });

    expect(importRes.ok).toBe(false);
    if (!importRes.ok) {
      expect(importRes.kind).toBe('failed');
      expect(importRes.message).toContain('FileTokenRegistry');
    }

    db.close();
  });

  it('accepts explicit typed fileTokens parameter when repository does not directly expose one', async () => {
    const { repo, db } = createTestRepo();
    const example = REFERENCE_EXAMPLES[0];
    const projectId = crypto.randomUUID();

    await repo.execute({
      commandId: 'project.create',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: {
        newProjectId: projectId,
        title: example.title,
        initialDocument: example.fixture,
        mainBranchId: crypto.randomUUID(),
        draftBranchId: crypto.randomUUID(),
      },
    });

    const project = (await repo.loadProject(projectId))!;
    const exportRes = await exportProjectJson({
      repository: repo,
      projectId,
      expectedProjectRevision: project.revision,
      mintId: () => crypto.randomUUID(),
    });
    expect(exportRes.ok).toBe(true);
    if (!exportRes.ok) throw new Error('export failed');

    const customRepo = new Proxy(repo, {
      has(target, prop) {
        if (prop === 'fileTokens') return false;
        return Reflect.has(target, prop);
      },
      get(target, prop) {
        if (prop === 'fileTokens') return undefined;
        const val = Reflect.get(target, prop, target);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });

    const importRes = await importProjectJson({
      repository: customRepo,
      fileTokens: repo.fileTokens,
      file: exportRes.blob,
      mintId: () => crypto.randomUUID(),
      actor: testActor,
    });

    expect(importRes.ok).toBe(true);
    db.close();
  });
});

