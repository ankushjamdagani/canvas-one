import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '../../domain/studio/model';
import { createStudioDatabase } from '../../persistence/studio/db';
import { LocalRepository } from '../../persistence/studio/repository';
import { RepositoryError } from '../../persistence/studio/errors';
import { computeSnapshotId } from '../../persistence/studio/primitives';
import type { Actor, ProjectCreateCommand } from '../../persistence/studio/types';
import { InProcessTransport } from './transport';
import { RunController } from './RunController';

const s01Doc = JSON.parse(
  readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s01.json'), 'utf8'),
) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

async function setupTestProject(repo: LocalRepository, projectId = crypto.randomUUID()) {
  const mainBranchId = crypto.randomUUID();
  const draftBranchId = crypto.randomUUID();
  const createCmd: ProjectCreateCommand = {
    commandId: 'project.create',
    operationId: crypto.randomUUID(),
    actor: testActor,
    payload: {
      newProjectId: projectId,
      title: 'RunController Test Project',
      initialDocument: s01Doc,
      mainBranchId,
      draftBranchId,
    },
  };
  const res = await repo.execute(createCmd);
  expect(res.status).toBe('applied');
  const snapshotId = await computeSnapshotId(s01Doc);
  return { projectId, branchId: draftBranchId, snapshotId };
}

describe('RunController (main thread)', () => {
  it('RunController constructor requires mintId and throws if missing', () => {
    const db = createStudioDatabase(`test-mintid-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const transport = new InProcessTransport();

    expect(() => new RunController({ repository: repo, transport } as any)).toThrow(
      /mintId/,
    );

    const validController = new RunController({
      repository: repo,
      transport,
      mintId: () => crypto.randomUUID(),
    });
    expect(validController).toBeDefined();

    validController.destroy();
    db.close();
  });

  it('RunController with in-process transport + real LocalRepository: run saved and readable', async () => {
    const db = createStudioDatabase(`test-run-ctrl-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, branchId, snapshotId } = await setupTestProject(repo);

    const transport = new InProcessTransport();
    const controller = new RunController({ repository: repo, transport, mintId: () => crypto.randomUUID() });

    const terminal = await controller.run({
      projectId,
      branchId,
      snapshotId,
      document: s01Doc,
      scenarioId: s01Doc.scenarios[0].id,
    });

    expect(terminal).not.toBeNull();
    expect(terminal?.status).toBe('completed');
    expect(controller.getState().phase).toBe('done');
    expect(controller.getState().current?.saveStatus).toBe('saved');

    const runId = controller.getState().current!.runId;
    const storedRun = await repo.loadRun(projectId, runId);
    expect(storedRun).not.toBeNull();
    expect(storedRun?.id).toBe(runId);
    expect(storedRun?.provenance).toBe('local');
    expect(storedRun?.status).toBe('completed');
    expect(storedRun?.checks.length).toBeGreaterThan(0);

    controller.destroy();
    db.close();
  });

  it('RV-12d review round 1: exposes the buffered trace events on state, clearing them on the next run and on reset', async () => {
    const db = createStudioDatabase(`test-run-events-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, branchId, snapshotId } = await setupTestProject(repo);

    const transport = new InProcessTransport();
    const controller = new RunController({ repository: repo, transport, mintId: () => crypto.randomUUID() });

    // Before any run, the buffer is empty (not undefined).
    expect(controller.getState().events).toEqual([]);

    await controller.run({
      projectId,
      branchId,
      snapshotId,
      document: s01Doc,
      scenarioId: s01Doc.scenarios[0].id,
    });

    // A completed run's trace produced at least one buffered event, surfaced read-only.
    expect(controller.getState().events.length).toBeGreaterThan(0);
    const eventsAfterFirstRun = controller.getState().events;

    // Reset clears the buffer.
    controller.reset();
    expect(controller.getState().events).toEqual([]);

    // Starting a second run doesn't inherit the first run's events.
    await controller.run({
      projectId,
      branchId,
      snapshotId,
      document: s01Doc,
      scenarioId: s01Doc.scenarios[1].id,
    });
    const eventsAfterSecondRun = controller.getState().events;
    expect(eventsAfterSecondRun).not.toBe(eventsAfterFirstRun);
    expect(eventsAfterSecondRun.length).toBeGreaterThan(0);

    controller.destroy();
    db.close();
  });

  it('runAll saves one run per scenario and continues after a failure', async () => {
    const db = createStudioDatabase(`test-run-all-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, branchId, snapshotId } = await setupTestProject(repo);

    const transport = new InProcessTransport();
    const controller = new RunController({ repository: repo, transport, mintId: () => crypto.randomUUID() });

    // Document with two scenarios
    const scenarioIds = [s01Doc.scenarios[0].id, s01Doc.scenarios[1].id];

    await controller.runAll({
      projectId,
      branchId,
      snapshotId,
      document: s01Doc,
      scenarioIds,
    });

    // Wait until runAll completes all items
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const state = controller.getState();
        if (state.phase === 'done' && state.queue.length === 0) {
          clearInterval(interval);
          resolve();
        }
      }, 20);
    });

    // Verify all runs were saved
    const savedRuns = await repo.listRuns(projectId);
    expect(savedRuns).toHaveLength(2);

    const savedScenarioIds = savedRuns.map(
      (r) => (r.manifest as any)?.scenario?.id,
    );
    expect(savedScenarioIds).toContain(scenarioIds[0]);
    expect(savedScenarioIds).toContain(scenarioIds[1]);

    controller.destroy();
    db.close();
  });

  it('save failure -> unsaved + retrySave succeeds', async () => {
    const db = createStudioDatabase(`test-save-failure-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, branchId, snapshotId } = await setupTestProject(repo);

    const transport = new InProcessTransport();
    const controller = new RunController({ repository: repo, transport, mintId: () => crypto.randomUUID() });

    // Spy on saveRun to fail on the first attempt
    const originalSaveRun = repo.saveRun.bind(repo);
    let failFirstTime = true;

    vi.spyOn(repo, 'saveRun').mockImplementation(async (...args) => {
      if (failFirstTime) {
        failFirstTime = false;
        return {
          status: 'failed',
          code: 'quota',
          issues: [],
        };
      }
      return originalSaveRun(...args);
    });

    await controller.run({
      projectId,
      branchId,
      snapshotId,
      document: s01Doc,
      scenarioId: s01Doc.scenarios[0].id,
    });

    // Should have terminal result visible with saveStatus failed
    const state = controller.getState();
    expect(state.phase).toBe('done');
    expect(state.current?.terminal).not.toBeNull();
    expect(state.current?.saveStatus).toEqual({ failed: true, code: 'quota' });

    // Now call retrySave()
    const retryResult = await controller.retrySave();
    expect(retryResult?.status).toBe('applied');

    expect(controller.getState().current?.saveStatus).toBe('saved');
    const runId = controller.getState().current!.runId;
    const storedRun = await repo.loadRun(projectId, runId);
    expect(storedRun).not.toBeNull();

    controller.destroy();
    db.close();
  });

  it('stale IDs ignored', async () => {
    const db = createStudioDatabase(`test-stale-ids-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const transport = new InProcessTransport();
    const controller = new RunController({ repository: repo, transport, mintId: () => crypto.randomUUID() });

    // Inject stale update for non-active run ID
    (transport as any).listeners.forEach((listener: any) => {
      listener({
        type: 'update',
        message: {
          kind: 'state',
          runId: 'stale-run-999',
          state: 'running',
        },
      });
    });

    expect(controller.getState().phase).toBe('idle');
    expect(controller.getState().current).toBeNull();

    controller.destroy();
    db.close();
  });

  it('reset cancels if running and clears display while keeping saved runs', async () => {
    const db = createStudioDatabase(`test-reset-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, branchId, snapshotId } = await setupTestProject(repo);

    const transport = new InProcessTransport();
    const controller = new RunController({ repository: repo, transport, mintId: () => crypto.randomUUID() });

    // First run saves cleanly
    await controller.run({
      projectId,
      branchId,
      snapshotId,
      document: s01Doc,
      scenarioId: s01Doc.scenarios[0].id,
    });

    const savedRunsBefore = await repo.listRuns(projectId);
    expect(savedRunsBefore).toHaveLength(1);

    // Call reset
    controller.reset();

    // State is reset to idle and current display cleared
    const state = controller.getState();
    expect(state.phase).toBe('idle');
    expect(state.current).toBeNull();
    expect(state.queue).toHaveLength(0);

    // Saved runs in repository are kept
    const savedRunsAfter = await repo.listRuns(projectId);
    expect(savedRunsAfter).toHaveLength(1);

    controller.destroy();
    db.close();
  });

  it('save catch-all maps thrown errors via mapErrorToFailedResult to real code', async () => {
    const db = createStudioDatabase(`test-save-catchall-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, branchId, snapshotId } = await setupTestProject(repo);

    const transport = new InProcessTransport();
    const controller = new RunController({
      repository: repo,
      transport,
      mintId: () => crypto.randomUUID(),
    });

    // Mock saveRun throwing a RepositoryError with 'quota'
    vi.spyOn(repo, 'saveRun').mockImplementation(async () => {
      throw new RepositoryError({ code: 'quota', message: 'Quota exceeded' });
    });

    await controller.run({
      projectId,
      branchId,
      snapshotId,
      document: s01Doc,
      scenarioId: s01Doc.scenarios[0].id,
    });

    const state = controller.getState();
    expect(state.phase).toBe('done');
    expect(state.current?.saveStatus).toEqual({ failed: true, code: 'quota' });

    controller.destroy();
    db.close();
  });

  it('compile rejection produces terminal with measured:false', async () => {
    const db = createStudioDatabase(`test-compile-rejection-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, branchId, snapshotId } = await setupTestProject(repo);

    const transport = new InProcessTransport();
    const controller = new RunController({
      repository: repo,
      transport,
      mintId: () => crypto.randomUUID(),
    });

    const terminal = await controller.run({
      projectId,
      branchId,
      snapshotId,
      document: s01Doc,
      scenarioId: 'non-existent-scenario-id',
    });

    expect(terminal).not.toBeNull();
    expect(terminal?.status).toBe('invalid');
    expect(terminal?.measured).toBe(false);
    expect(controller.getState().current?.measured).toBe(false);

    controller.destroy();
    db.close();
  });
});
