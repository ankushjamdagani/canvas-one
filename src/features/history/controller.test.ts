import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document, Id } from '../../domain/studio/model';
import { createStudioDatabase } from '../../persistence/studio/db';
import { LocalRepository } from '../../persistence/studio/repository';
import type { Actor } from '../../persistence/studio/types';
import { SessionController } from '../session/controller';
import { InProcessTransport } from '../runs/transport';
import { RunController } from '../runs/RunController';
import { HistoryController } from './controller';

const s01Doc = JSON.parse(
  readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s01.json'), 'utf8'),
) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

function createMintId(): () => Id {
  let idCounter = 0;
  return () => {
    idCounter++;
    const hex = idCounter.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
}

/** Runs every scenario in the document to completion via the real runner, seeding
 * saved runs so the current fingerprint has a qualifying run per scenario (D27/D28). */
async function runAllScenarios(
  repo: LocalRepository,
  mintId: () => Id,
  projectId: Id,
  branchId: Id,
  snapshotId: string,
  document: Document,
): Promise<void> {
  const transport = new InProcessTransport();
  const runController = new RunController({ repository: repo, transport, mintId });
  for (const scenario of document.scenarios) {
    const terminal = await runController.run({
      projectId,
      branchId,
      snapshotId,
      document,
      scenarioId: scenario.id,
    });
    expect(terminal).not.toBeNull();
  }
  runController.destroy();
}

async function setup() {
  const db = createStudioDatabase(`test-history-ctrl-${crypto.randomUUID()}`);
  const repo = new LocalRepository(db);
  const mintId = createMintId();
  const session = new SessionController({ repository: repo, mintId, actor: testActor });

  const created = await session.createProject({ title: 'History Controller Test', initialDocument: s01Doc });
  if (created.status !== 'applied') {
    throw new Error(`setup failed: ${JSON.stringify(created)}`);
  }

  const projectId = session.getState().projectId;
  if (!projectId) {
    throw new Error('setup failed: no projectId after createProject');
  }

  const history = new HistoryController({
    repository: repo,
    session,
    mintId,
    actor: testActor,
  });

  // The constructor fires an initial async loadHistory() reactively; await the
  // controller's own reload directly for a deterministic starting state.
  await history.loadHistory();

  return { db, repo, mintId, session, history, projectId };
}

describe('HistoryController (real LocalRepository, S01)', () => {
  it('refuses commit until every scenario has a qualifying run for the current fingerprint', async () => {
    const { db, repo, history } = await setup();

    const res = await history.commit('Attempt before any run');
    expect(res.status).toBe('failed');
    if (res.status === 'failed') {
      expect(res.code).toBe('ineligible');
    }
    if ('ineligibleScenarios' in res) {
      expect(res.ineligibleScenarios.length).toBe(s01Doc.scenarios.length);
    }

    db.close();
    void repo;
  });

  it('commits successfully once every scenario passes, with evidence = latest qualifying run per scenario', async () => {
    const { db, repo, mintId, session, history, projectId } = await setup();
    const sessionState = session.getState();
    if (!sessionState.branchId || !sessionState.workingSnapshotId || !sessionState.document) {
      throw new Error('session not ready');
    }

    await runAllScenarios(
      repo,
      mintId,
      projectId,
      sessionState.branchId,
      sessionState.workingSnapshotId,
      sessionState.document,
    );

    const res = await history.commit('Ship checkout scenarios');
    expect(res.status).toBe('applied');

    // Evidence: one ref per scenario, each pointing at a saved run for that scenario's
    // current fingerprint (run-identity.md §5 eligibility; commands.md history.commit).
    const commits = history.commits;
    expect(commits.length).toBeGreaterThan(0);
    const head = commits[0];
    expect(head.evidence.length).toBe(s01Doc.scenarios.length);
    const scenarioIds = new Set(s01Doc.scenarios.map((s) => s.id));
    for (const ev of head.evidence) {
      expect(scenarioIds.has(ev.scenarioId)).toBe(true);
      const run = await repo.loadRun(projectId, ev.runId);
      expect(run).not.toBeNull();
      expect(run?.fingerprint).toBe(ev.fingerprint);
    }

    db.close();
  });

  it('saves a checkpoint and restores from it (not on main)', async () => {
    const { db, session, history } = await setup();

    const cpRes = await history.saveCheckpoint('Before big change');
    expect(cpRes.status).toBe('applied');

    expect(history.checkpoints.length).toBe(1);
    const checkpoint = history.checkpoints[0];
    expect(checkpoint.label).toBe('Before big change');

    const restoreRes = await history.restore(checkpoint.id, 'Pre-restore checkpoint');
    expect(restoreRes.status).toBe('applied');

    db.close();
    void session;
  });

  it('rejects restore when the pre-restore checkpoint label is missing, empty, or too long', async () => {
    const { db, history } = await setup();

    const cpRes = await history.saveCheckpoint('Before big change');
    expect(cpRes.status).toBe('applied');
    const checkpoint = history.checkpoints[0];

    const emptyRes = await history.restore(checkpoint.id, '');
    expect(emptyRes.status).toBe('invalid');

    const whitespaceRes = await history.restore(checkpoint.id, '   ');
    expect(whitespaceRes.status).toBe('invalid');

    const tooLongRes = await history.restore(checkpoint.id, 'x'.repeat(81));
    expect(tooLongRes.status).toBe('invalid');

    db.close();
  });

  it('restore passes the given pre-restore checkpoint label through to the new checkpoint', async () => {
    const { db, history } = await setup();

    const cpRes = await history.saveCheckpoint('Before big change');
    expect(cpRes.status).toBe('applied');
    const checkpoint = history.checkpoints[0];

    const restoreRes = await history.restore(checkpoint.id, 'My custom restore label');
    expect(restoreRes.status).toBe('applied');

    const preRestoreCheckpoint = history.checkpoints.find(
      (c) => c.label === 'My custom restore label',
    );
    expect(preRestoreCheckpoint).toBeDefined();

    db.close();
  });

  it('rejects commit and restore directly on main (D40)', async () => {
    const { db, session, history, projectId } = await setup();
    const mainBranchId = session.getState().mainBranchId;
    if (!mainBranchId) throw new Error('no main branch');

    const opened = await session.openProject(projectId, mainBranchId);
    expect(opened.status).toBe('ready');
    // The session-change subscription reloads history reactively (fire-and-forget);
    // await the controller's own reload directly for a deterministic assertion.
    await history.loadHistory();
    expect(history.isMain).toBe(true);

    const commitRes = await history.commit('Direct commit on main');
    expect(commitRes.status).toBe('invalid');

    const restoreRes = await history.restore('some-id', 'Pre-restore checkpoint');
    expect(restoreRes.status).toBe('invalid');

    db.close();
  });

  it('reports HEAD_MOVED when expectedHeadId does not match the branch head', async () => {
    const { db, repo, mintId, session, history, projectId } = await setup();
    const sessionState = session.getState();
    if (!sessionState.branchId || !sessionState.workingSnapshotId || !sessionState.document) {
      throw new Error('session not ready');
    }

    await runAllScenarios(
      repo,
      mintId,
      projectId,
      sessionState.branchId,
      sessionState.workingSnapshotId,
      sessionState.document,
    );

    // repository.ts returns {status:'failed', code:'conflict'} for a head mismatch
    // (HEAD_MOVED), distinct from the working-revision {status:'stale'} case.
    const res = await history.commit('Should be stale', {
      expectedHeadId: '00000000-0000-4000-8000-999999999999',
    });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') {
      expect(res.code).toBe('conflict');
    }

    db.close();
  });
});
