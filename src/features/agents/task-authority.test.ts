import { describe, expect, it } from 'vitest';
import { TaskRepository, type TaskStorage } from '@canvas-one/agents';
import type { SessionController } from '../session/controller';
import { readAuthorizedTask } from './task-authority';

const scope = { projectId: 'project', branchId: 'draft', boardId: 'board' };
const identity = { ...scope, taskId: 'task', attemptId: 'attempt', actorId: 'agent:claude', generation: 1 };
async function setup() {
  let raw: string | null = null;
  const storage: TaskStorage = { load: async () => raw, compareAndSwap: async (_revision, next) => { raw = next; return true; } };
  const opened = await TaskRepository.open(storage);
  if (!opened.ok) throw new Error(opened.code);
  const repository = opened.repository;
  await repository.execute({ type: 'create', ...scope, scope, taskId: identity.taskId, attemptId: identity.attemptId, actorId: identity.actorId, instruction: 'Improve board', providerId: 'claude' }, 0);
  await repository.execute({ type: 'start', taskId: identity.taskId, attemptId: identity.attemptId, actorId: identity.actorId, generation: 1, scope }, 1);
  let current = { projectId: scope.projectId, branchId: scope.branchId, document: { id: scope.boardId } };
  const session = { getState: () => current } as unknown as SessionController;
  return { storage, repository, session, navigate: () => { current = { ...current, branchId: 'other' }; } };
}
describe('fresh browser task authority', () => {
  it('requires the persisted agent, editing mode and exact continuation', async () => {
    const { storage, session } = await setup();
    await expect(readAuthorizedTask(storage, session, identity, { provider: 'claude', mode: 'task' })).resolves.toMatchObject({ providerId: 'claude' });
    for (const metadata of [{ provider: 'codex', mode: 'task' }, { provider: 'claude', mode: 'question' }, { provider: 'claude', mode: 'task', providerSessionId: 'other' }] as const) {
      await expect(readAuthorizedTask(storage, session, identity, metadata)).rejects.toThrow('identity changed');
    }
  });
  it('reads a durable Stop rather than trusting a previously displayed task', async () => {
    const { storage, session, repository } = await setup();
    await readAuthorizedTask(storage, session, identity);
    await repository.execute({ type: 'stop', taskId: identity.taskId, actorId: identity.actorId, scope, attemptId: identity.attemptId, generation: identity.generation }, 2);
    await expect(readAuthorizedTask(storage, session, identity)).rejects.toThrow('no longer authorized');
  });
  it('rejects navigation during storage I/O', async () => {
    const fixture = await setup();
    const storage: TaskStorage = { ...fixture.storage, load: async () => { const raw = await fixture.storage.load(); fixture.navigate(); return raw; } };
    await expect(readAuthorizedTask(storage, fixture.session, identity)).rejects.toThrow('changed during authorization');
  });
  it('rejects corruption without resetting saved progress', async () => {
    const fixture = await setup();
    await expect(readAuthorizedTask({ ...fixture.storage, load: async () => '{bad' }, fixture.session, identity)).rejects.toThrow('invalid-storage');
    expect(await fixture.storage.load()).toContain('Improve board');
  });
});
