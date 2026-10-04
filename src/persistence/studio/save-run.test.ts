import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudioDatabase } from './db';
import { LocalRepository } from './repository';
import { mintRunStartToken } from './token';
import { computeSnapshotId } from './primitives';
import type { Actor, ProjectCreateCommand } from './types';
import type { Document } from '../../domain/studio/model';
import type { CheckResult, RunSummary, TerminalStatus, TraceEvent } from '../../domain/studio/runner/types';
import { emptyCycleSummary } from '../../domain/studio/runner/cycles';

const s01Doc = JSON.parse(
  readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s01.json'), 'utf8'),
) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

function createMockSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    mode: 'logical',
    cycles: emptyCycleSummary(),
    consumedInputs: 1,
    rootCounts: {
      generated: 1,
      succeeded: 1,
      rejected: 0,
      failed: 0,
      expired: 0,
      inFlight: 0,
    },
    messageCounts: {
      generated: 0,
      succeeded: 0,
      rejected: 0,
      failed: 0,
      expired: 0,
      inFlight: 0,
    },
    elementMetrics: [],
    finalStates: [{ elementId: 'checkout', stateId: 'succeeded', context: {} }],
    outputs: [],
    coverage: {
      includedElementIds: ['checkout'],
      excludedElementIds: [],
    },
    processedEvents: 4,
    elapsedMs: null,
    rowOutcomes: [],
    ...overrides,
  };
}

describe('saveRun and run reads on fake-indexeddb', () => {
  async function setupProject(repo: LocalRepository, projectId = crypto.randomUUID()) {
    const mainBranchId = crypto.randomUUID();
    const draftBranchId = crypto.randomUUID();
    const createCmd: ProjectCreateCommand = {
      commandId: 'project.create',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: {
        newProjectId: projectId,
        title: 'SaveRun Test Project',
        initialDocument: s01Doc,
        mainBranchId,
        draftBranchId,
      },
    };
    const createRes = await repo.execute(createCmd);
    expect(createRes.status).toBe('applied');
    const snapshotId = await computeSnapshotId(s01Doc);
    return { projectId, snapshotId };
  }

  it('valid token saves run and chunks atomically with provenance local and traceState complete', async () => {
    const db = createStudioDatabase(`test-save-run-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupProject(repo);

    const runId = crypto.randomUUID();
    const fingerprint = 'ss-run-v1:test-fingerprint';
    const manifest = { scenario: { id: 's01-happy', assertions: [] } };

    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId,
      manifest,
      fingerprint,
    });

    const checks: CheckResult[] = [
      { assertionId: 'assert-1', status: 'passed', actual: 'succeeded', reason: null },
    ];
    const summary = createMockSummary();
    const terminalResult = {
      runId,
      fingerprint,
      status: 'completed' as TerminalStatus,
      checks,
      summary,
    };

    const traceEvents: TraceEvent[] = [
      {
        id: `${runId}:0`,
        sequence: 0,
        rootId: 'root-1',
        journeyId: crypto.randomUUID(),
        parentId: null,
        elementId: 'checkout',
        portId: null,
        kind: 'input',
        code: 'submit',
        payloadRef: null,
        atMs: null,
        outcome: null,
      },
    ];

    const saveRes = await repo.saveRun(token, terminalResult, traceEvents);
    expect(saveRes.status).toBe('applied');
    if (saveRes.status === 'applied') {
      expect(saveRes.runId).toBe(runId);
      expect(saveRes.run.provenance).toBe('local');
      expect(saveRes.run.traceState).toBe('complete');
      expect(saveRes.run.status).toBe('completed');
    }

    // Verify row in runs table
    const storedRun = await repo.loadRun(projectId, runId);
    expect(storedRun).not.toBeNull();
    expect(storedRun?.id).toBe(runId);
    expect(storedRun?.provenance).toBe('local');
    expect(storedRun?.fingerprint).toBe(fingerprint);
    expect(storedRun?.traceState).toBe('complete');

    // Verify trace chunk in traceChunks table
    const chunks = await db.traceChunks.where('[projectId+runId]').equals([projectId, runId]).toArray();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].events).toHaveLength(1);
    expect(chunks[0].events[0].id).toBe(`${runId}:0`);

    db.close();
  });

  it('rejects a forged or manually constructed token with invalid', async () => {
    const db = createStudioDatabase(`test-forged-token-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupProject(repo);

    const runId = crypto.randomUUID();
    // Forged token: object literal not minted via mintRunStartToken
    const forgedToken = {
      projectId,
      runId,
      snapshotId,
      manifest: {},
      fingerprint: 'ss-run-v1:forged',
    };

    const terminalResult = {
      runId,
      fingerprint: 'ss-run-v1:forged',
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary(),
    };

    const saveRes = await repo.saveRun(forgedToken, terminalResult, []);
    expect(saveRes.status).toBe('invalid');
    if (saveRes.status === 'invalid') {
      expect(saveRes.issues[0].code).toBe('structural-rule');
    }

    db.close();
  });

  it('rejects mismatched runId between token and terminal result with invalid and writes nothing', async () => {
    const db = createStudioDatabase(`test-mismatched-token-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupProject(repo);

    const tokenRunId = crypto.randomUUID();
    const mismatchedRunId = crypto.randomUUID();
    const fingerprint = 'ss-run-v1:test';

    const token = mintRunStartToken({
      projectId,
      runId: tokenRunId,
      snapshotId,
      manifest: {},
      fingerprint,
    });

    const terminalResult = {
      runId: mismatchedRunId, // different run ID!
      fingerprint,
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary(),
    };

    const saveRes = await repo.saveRun(token, terminalResult, []);
    expect(saveRes.status).toBe('invalid');
    if (saveRes.status === 'invalid') {
      expect(saveRes.issues[0].code).toBe('structural-rule');
    }

    // Verify nothing written
    expect(await repo.loadRun(projectId, tokenRunId)).toBeNull();
    expect(await repo.loadRun(projectId, mismatchedRunId)).toBeNull();

    db.close();
  });

  it('rejects non-terminal statuses with invalid', async () => {
    const db = createStudioDatabase(`test-non-terminal-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupProject(repo);

    const runId = crypto.randomUUID();
    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId,
      manifest: {},
      fingerprint: 'ss-run-v1:test',
    });

    const nonTerminalResult = {
      runId,
      fingerprint: 'ss-run-v1:test',
      status: 'running', // non-terminal!
      checks: [],
      summary: createMockSummary(),
    };

    const saveRes = await repo.saveRun(token, nonTerminalResult, []);
    expect(saveRes.status).toBe('invalid');
    if (saveRes.status === 'invalid') {
      expect(saveRes.issues[0].code).toBe('invalid-literal');
    }

    db.close();
  });

  it('simulated quota error maps to quota and leaves no partial rows', async () => {
    const db = createStudioDatabase(`test-quota-run-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupProject(repo);

    const runId = crypto.randomUUID();
    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId,
      manifest: {},
      fingerprint: 'ss-run-v1:test',
    });

    // Intercept db.traceChunks.add to simulate QuotaExceededError mid-transaction
    const originalAdd = db.traceChunks.add.bind(db.traceChunks);
    db.traceChunks.add = (async () => {
      const quotaErr = new Error('QuotaExceededError');
      quotaErr.name = 'QuotaExceededError';
      throw quotaErr;
    }) as any;

    const terminalResult = {
      runId,
      fingerprint: 'ss-run-v1:test',
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary(),
    };

    const saveRes = await repo.saveRun(token, terminalResult, [
      {
        id: `${runId}:0`,
        sequence: 0,
        rootId: 'root-1',
        journeyId: crypto.randomUUID(),
        parentId: null,
        elementId: 'checkout',
        portId: null,
        kind: 'input',
        code: 'submit',
        payloadRef: null,
        atMs: null,
        outcome: null,
      },
    ]);

    expect(saveRes.status).toBe('failed');
    if (saveRes.status === 'failed') {
      expect(saveRes.code).toBe('quota');
    }

    // Verify rollback: no run row was saved
    const runRow = await repo.loadRun(projectId, runId);
    expect(runRow).toBeNull();

    const chunkRows = await db.traceChunks.where('[projectId+runId]').equals([projectId, runId]).count();
    expect(chunkRows).toBe(0);

    db.traceChunks.add = originalAdd;
    db.close();
  });

  it('enforces retention: 20 unpinned runs then a 21st fails with limit and writes nothing', async () => {
    const db = createStudioDatabase(`test-retention-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupProject(repo);

    // Save 20 unpinned runs
    for (let i = 0; i < 20; i++) {
      const rId = crypto.randomUUID();
      const fp = `ss-run-v1:fp-${i}`;
      const tok = mintRunStartToken({
        projectId,
        runId: rId,
        snapshotId,
        manifest: {},
        fingerprint: fp,
      });
      const term = {
        runId: rId,
        fingerprint: fp,
        status: 'completed' as TerminalStatus,
        checks: [],
        summary: createMockSummary(),
        completedAt: 1000 + i,
      };
      const res = await repo.saveRun(tok, term, []);
      expect(res.status).toBe('applied');
    }

    expect(await db.runs.where('projectId').equals(projectId).count()).toBe(20);

    // Attempting 21st unpinned run must fail with limit
    const run21Id = crypto.randomUUID();
    const fp21 = 'ss-run-v1:fp-21';
    const token21 = mintRunStartToken({
      projectId,
      runId: run21Id,
      snapshotId,
      manifest: {},
      fingerprint: fp21,
    });
    const term21 = {
      runId: run21Id,
      fingerprint: fp21,
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary(),
      completedAt: 2000,
    };

    const res21 = await repo.saveRun(token21, term21, []);
    expect(res21.status).toBe('failed');
    if (res21.status === 'failed') {
      expect(res21.code).toBe('limit');
      expect(res21.issues[0].message).toContain('Explicit prune is required');
    }

    // Verify 21st run was not written
    expect(await db.runs.where('projectId').equals(projectId).count()).toBe(20);
    expect(await repo.loadRun(projectId, run21Id)).toBeNull();

    db.close();
  });

  it('enforces immutability: a saved run cannot be overwritten with conflicting content', async () => {
    const db = createStudioDatabase(`test-immutable-run-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupProject(repo);

    const runId = crypto.randomUUID();
    const fingerprint = 'ss-run-v1:fp-initial';
    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId,
      manifest: { scenario: { id: 's01', assertions: [] } },
      fingerprint,
    });

    const term1 = {
      runId,
      fingerprint,
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary({ processedEvents: 5 }),
    };

    const res1 = await repo.saveRun(token, term1, []);
    expect(res1.status).toBe('applied');

    // Attempting to overwrite with conflicting summary/content
    const termConflicting = {
      runId,
      fingerprint,
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary({ processedEvents: 999 }), // conflicting!
    };

    const res2 = await repo.saveRun(token, termConflicting, []);
    expect(res2.status).toBe('invalid');
    if (res2.status === 'invalid') {
      expect(res2.issues[0].message).toContain('Conflicting immutable row');
    }

    // Verify original content was untouched
    const stored = await repo.loadRun(projectId, runId);
    expect(stored?.summary.processedEvents).toBe(5);

    db.close();
  });

  it('reads runs via listRuns and runsByFingerprint using compound index', async () => {
    const db = createStudioDatabase(`test-reads-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupProject(repo);

    const fpA = 'ss-run-v1:shared-fp-a';
    const fpB = 'ss-run-v1:shared-fp-b';

    const run1Id = crypto.randomUUID();
    const run2Id = crypto.randomUUID();
    const run3Id = crypto.randomUUID();

    const tok1 = mintRunStartToken({ projectId, runId: run1Id, snapshotId, manifest: {}, fingerprint: fpA });
    const tok2 = mintRunStartToken({ projectId, runId: run2Id, snapshotId, manifest: {}, fingerprint: fpA });
    const tok3 = mintRunStartToken({ projectId, runId: run3Id, snapshotId, manifest: {}, fingerprint: fpB });

    await repo.saveRun(tok1, { runId: run1Id, fingerprint: fpA, status: 'completed' as TerminalStatus, checks: [], summary: createMockSummary() }, []);
    await repo.saveRun(tok2, { runId: run2Id, fingerprint: fpA, status: 'completed' as TerminalStatus, checks: [], summary: createMockSummary() }, []);
    await repo.saveRun(tok3, { runId: run3Id, fingerprint: fpB, status: 'completed' as TerminalStatus, checks: [], summary: createMockSummary() }, []);

    // listRuns
    const all = await repo.listRuns(projectId);
    expect(all).toHaveLength(3);

    // runsByFingerprint for fpA
    const runsA = await repo.runsByFingerprint(projectId, fpA);
    expect(runsA).toHaveLength(2);
    expect(runsA.map((r) => r.id).sort()).toEqual([run1Id, run2Id].sort());

    // runsByFingerprint for fpB
    const runsB = await repo.runsByFingerprint(projectId, fpB);
    expect(runsB).toHaveLength(1);
    expect(runsB[0].id).toBe(run3Id);

    db.close();
  });

  // Review Requirement 1: a token minted for project A can't save into project B
  it('a token minted for project A cannot save into project B', async () => {
    const db = createStudioDatabase(`test-project-binding-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId: projectA, snapshotId } = await setupProject(repo);
    const { projectId: projectB } = await setupProject(repo);

    const runId = crypto.randomUUID();
    const fingerprint = 'ss-run-v1:test-project-binding';
    const token = mintRunStartToken({
      projectId: projectA,
      runId,
      snapshotId,
      manifest: {},
      fingerprint,
    });

    const terminalResult = {
      runId,
      fingerprint,
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary(),
    };

    // Caller attempts to save into project B via options
    const saveResOptions = await repo.saveRun(token, terminalResult, [], { projectId: projectB });
    expect(saveResOptions.status).toBe('invalid');
    if (saveResOptions.status === 'invalid') {
      expect(saveResOptions.issues[0].code).toBe('structural-rule');
      expect(saveResOptions.issues[0].message).toContain('Caller-supplied projectId');
    }

    // Caller attempts to save into project B via terminalResult.projectId
    const saveResTerm = await repo.saveRun(token, { ...terminalResult, projectId: projectB }, []);
    expect(saveResTerm.status).toBe('invalid');
    if (saveResTerm.status === 'invalid') {
      expect(saveResTerm.issues[0].code).toBe('structural-rule');
      expect(saveResTerm.issues[0].message).toContain('Terminal result projectId');
    }

    // Verify nothing written to project A or project B
    expect(await repo.loadRun(projectA, runId)).toBeNull();
    expect(await repo.loadRun(projectB, runId)).toBeNull();

    db.close();
  });

  // Review Requirement 2: token is deep-frozen and mutating fields does not affect saved run or fails as invalid
  it('token is deep-frozen and mutating fields after minting does not change what gets saved or fails as invalid', async () => {
    const db = createStudioDatabase(`test-token-frozen-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupProject(repo);

    const runId = crypto.randomUUID();
    const fingerprint = 'ss-run-v1:original-fp';
    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId,
      manifest: { scenario: { id: 's01' } },
      fingerprint,
    });

    // 1. Verify token and nested manifest are deep-frozen
    expect(Object.isFrozen(token)).toBe(true);
    expect(Object.isFrozen(token.manifest)).toBe(true);

    // 2. Direct mutation throws TypeError in strict mode
    expect(() => {
      (token as any).runId = crypto.randomUUID();
    }).toThrow();
    expect(() => {
      (token as any).fingerprint = 'ss-run-v1:tampered';
    }).toThrow();

    // 3. saveRun reads from token binding and saves bound data
    const terminalResult = {
      runId,
      fingerprint,
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary(),
    };

    const saveRes = await repo.saveRun(token, terminalResult, []);
    expect(saveRes.status).toBe('applied');
    if (saveRes.status === 'applied') {
      expect(saveRes.run.id).toBe(runId);
      expect(saveRes.run.fingerprint).toBe(fingerprint);
      expect(saveRes.run.projectId).toBe(projectId);
    }

    const loaded = await repo.loadRun(projectId, runId);
    expect(loaded?.id).toBe(runId);
    expect(loaded?.fingerprint).toBe(fingerprint);

    db.close();
  });

  // Review Requirement 3: terminal manifest fingerprint mismatch rejects and writes nothing
  it('rejects mismatched terminal manifest fingerprint with invalid and writes nothing', async () => {
    const db = createStudioDatabase(`test-mismatched-fp-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupProject(repo);

    const runId = crypto.randomUUID();
    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId,
      manifest: {},
      fingerprint: 'ss-run-v1:token-fingerprint',
    });

    const terminalResult = {
      runId,
      fingerprint: 'ss-run-v1:different-terminal-fingerprint', // mismatch!
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary(),
    };

    const saveRes = await repo.saveRun(token, terminalResult, []);
    expect(saveRes.status).toBe('invalid');
    if (saveRes.status === 'invalid') {
      expect(saveRes.issues[0].code).toBe('structural-rule');
      expect(saveRes.issues[0].message).toContain('Manifest fingerprint in terminal result');
    }

    // Nothing written
    expect(await repo.loadRun(projectId, runId)).toBeNull();

    db.close();
  });

  // Review Requirement 4: document fallback inserting missing snapshot
  it('inserts missing snapshot via document fallback when hash matches binding snapshotId', async () => {
    const db = createStudioDatabase(`test-doc-fallback-success-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const projectId = crypto.randomUUID();

    // Create project with a different initial document so s01Doc is NOT in db.snapshots
    const initialDoc: Document = {
      ...s01Doc,
      title: 'Initial Non-Matching Doc',
    };
    const mainBranchId = crypto.randomUUID();
    const draftBranchId = crypto.randomUUID();
    const createCmd: ProjectCreateCommand = {
      commandId: 'project.create',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: {
        newProjectId: projectId,
        title: 'Doc Fallback Project',
        initialDocument: initialDoc,
        mainBranchId,
        draftBranchId,
      },
    };
    await repo.execute(createCmd);

    // Compute snapshotId of s01Doc (which is NOT in the database)
    const missingSnapshotId = await computeSnapshotId(s01Doc);
    expect(await db.snapshots.get([projectId, missingSnapshotId])).toBeUndefined();

    const runId = crypto.randomUUID();
    const fingerprint = 'ss-run-v1:test-doc-fallback';
    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId: missingSnapshotId,
      manifest: {},
      fingerprint,
      document: s01Doc, // Supplied in token binding
    });

    const terminalResult = {
      runId,
      fingerprint,
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary(),
    };

    const saveRes = await repo.saveRun(token, terminalResult, []);
    expect(saveRes.status).toBe('applied');

    // Snapshot was inserted into db.snapshots
    const insertedSnap = await db.snapshots.get([projectId, missingSnapshotId]);
    expect(insertedSnap).toBeDefined();
    expect(insertedSnap?.id).toBe(missingSnapshotId);
    expect(insertedSnap?.document.title).toBe(s01Doc.title);

    // Run was saved
    const savedRun = await repo.loadRun(projectId, runId);
    expect(savedRun).not.toBeNull();
    expect(savedRun?.snapshotId).toBe(missingSnapshotId);

    db.close();
  });

  it('rejects document fallback when document hash does not match binding snapshotId and writes nothing', async () => {
    const db = createStudioDatabase(`test-doc-fallback-mismatch-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId } = await setupProject(repo);

    const nonExistentSnapshotId = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const runId = crypto.randomUUID();
    const fingerprint = 'ss-run-v1:test-fallback-mismatch';

    // Token specifies snapshotId X, but document has snapshotId Y
    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId: nonExistentSnapshotId,
      manifest: {},
      fingerprint,
      document: s01Doc, // Hash of s01Doc does NOT match nonExistentSnapshotId!
    });

    const terminalResult = {
      runId,
      fingerprint,
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary(),
    };

    const saveRes = await repo.saveRun(token, terminalResult, []);
    expect(saveRes.status).toBe('invalid');
    if (saveRes.status === 'invalid') {
      expect(saveRes.issues[0].code).toBe('structural-rule');
      expect(saveRes.issues[0].message).toContain('does not match token snapshot ID');
    }

    // Nothing written
    expect(await db.snapshots.get([projectId, nonExistentSnapshotId])).toBeUndefined();
    expect(await repo.loadRun(projectId, runId)).toBeNull();

    db.close();
  });

  it('rejects missing snapshot when no document fallback is provided and writes nothing', async () => {
    const db = createStudioDatabase(`test-doc-fallback-missing-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId } = await setupProject(repo);

    const nonExistentSnapshotId = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const runId = crypto.randomUUID();
    const fingerprint = 'ss-run-v1:test-fallback-none';

    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId: nonExistentSnapshotId,
      manifest: {},
      fingerprint,
      // No document provided!
    });

    const terminalResult = {
      runId,
      fingerprint,
      status: 'completed' as TerminalStatus,
      checks: [],
      summary: createMockSummary(),
    };

    const saveRes = await repo.saveRun(token, terminalResult, []);
    expect(saveRes.status).toBe('invalid');
    if (saveRes.status === 'invalid') {
      expect(saveRes.issues[0].code).toBe('dangling-reference');
      expect(saveRes.issues[0].message).toContain('does not exist for project');
    }

    // Nothing written
    expect(await db.snapshots.get([projectId, nonExistentSnapshotId])).toBeUndefined();
    expect(await repo.loadRun(projectId, runId)).toBeNull();

    db.close();
  });
});

