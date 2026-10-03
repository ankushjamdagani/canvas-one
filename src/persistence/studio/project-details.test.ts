import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudioDatabase } from './db';
import { LocalRepository } from './repository';
import { projectDetails, projectExposures, type Actor, type ProjectUpdateDetailsCommand } from './types';
import type { Document } from '../../domain/studio/model';

const s01Doc = JSON.parse(readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s01.json'), 'utf8')) as Document;
const actor: Actor = { actorId: 'test-user', kind: 'local-human', displayName: 'Test User' };

async function setup() {
  const db = createStudioDatabase(`test-project-details-${crypto.randomUUID()}`);
  const repo = new LocalRepository(db);
  const projectId = crypto.randomUUID();
  const created = await repo.execute({
    commandId: 'project.create',
    operationId: crypto.randomUUID(),
    actor,
    payload: {
      newProjectId: projectId,
      title: 'Details',
      initialDocument: s01Doc,
      mainBranchId: crypto.randomUUID(),
      draftBranchId: crypto.randomUUID(),
    },
  });
  expect(created.status).toBe('applied');
  const command = (overrides: Partial<ProjectUpdateDetailsCommand> = {}): ProjectUpdateDetailsCommand => ({
    commandId: 'project.update-details',
    operationId: crypto.randomUUID(),
    projectId,
    expectedProjectRevision: 0,
    actor,
    payload: { description: '  Payments core  ', team: 'Platform' },
    ...overrides,
  });
  return { db, repo, projectId, command };
}

describe('project.update-details (D52)', () => {
  it('stores trimmed details, advances the project revision and leaves branches and snapshots alone', async () => {
    const { db, repo, projectId, command } = await setup();
    const branchesBefore = await db.branches.where('projectId').equals(projectId).toArray();
    const snapshotsBefore = await db.snapshots.where('projectId').equals(projectId).count();

    const result = await repo.execute(command());
    expect(result).toMatchObject({ status: 'applied', projectRevision: 1, branchRevision: null });

    const project = await repo.loadProject(projectId);
    expect(projectDetails(project!)).toEqual({ description: 'Payments core', team: 'Platform' });
    expect(project?.revision).toBe(1);
    expect(await db.branches.where('projectId').equals(projectId).toArray()).toEqual(branchesBefore);
    expect(await db.snapshots.where('projectId').equals(projectId).count()).toBe(snapshotsBefore);
    db.close();
  });

  it('stores exposed connection types (D53) and rejects unknown, repeated or misplaced ones', async () => {
    const { db, repo, projectId, command } = await setup();
    const exposures = [{ channel: 'call', protocol: 'grpc', path: '/orders' }, { channel: 'message', protocol: 'kafka', path: 'orders.created' }] as const;
    expect(await repo.execute(command({ payload: { description: '', team: '', exposures } }))).toMatchObject({ status: 'applied' });
    expect(projectExposures((await repo.loadProject(projectId))!)).toEqual(exposures);

    // A later update without exposures leaves them alone.
    await repo.execute(command({ expectedProjectRevision: 1, payload: { description: 'x', team: '' } }));
    expect(projectExposures((await repo.loadProject(projectId))!)).toEqual(exposures);

    for (const bad of [[{ channel: 'call', protocol: 'kafka', path: '' }], [exposures[0], exposures[0]], [{ channel: 'event', protocol: 'grpc', path: '' }], [{ channel: 'call', protocol: 'grpc', path: ' padded ' }]]) {
      const result = await repo.execute(command({ expectedProjectRevision: 2, payload: { description: '', team: '', exposures: bad as never } }));
      expect(result.status).toBe('invalid');
    }
    expect((await repo.loadProject(projectId))?.revision).toBe(2);
    db.close();
  });

  it('is idempotent for a retried operation and stale for an old revision', async () => {
    const { db, repo, command } = await setup();
    const first = command();
    const applied = await repo.execute(first);
    expect(await repo.execute(first)).toEqual(applied);
    const stale = await repo.execute(command());
    expect(stale).toMatchObject({ status: 'stale', scope: 'project', expected: 0, actual: 1 });
    db.close();
  });

  it('rejects over-long and non-string fields', async () => {
    const { db, repo, command } = await setup();
    const tooLong = await repo.execute(command({ payload: { description: 'x'.repeat(501), team: '' } }));
    expect(tooLong).toMatchObject({ status: 'invalid' });
    const wrong = await repo.execute(command({ payload: { description: '', team: 5 as unknown as string } }));
    expect(wrong).toMatchObject({ status: 'invalid' });
    db.close();
  });

  it('reads absent details as empty', () => {
    expect(projectDetails({})).toEqual({ description: '', team: '' });
  });
});
