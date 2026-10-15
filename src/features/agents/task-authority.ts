import { TaskRepository, type AttemptBinding, type CollaborationTask, type TaskStorage } from '@canvas-one/agents';
import type { ExecutionIdentity, LocalAgentProvider } from '@canvas-one/agent-bridge';
import type { SessionController } from '../session/controller';

export function attemptBinding(identity: ExecutionIdentity): AttemptBinding {
  return { taskId: identity.taskId, attemptId: identity.attemptId, actorId: identity.actorId, generation: identity.generation,
    scope: { projectId: identity.projectId, branchId: identity.branchId, boardId: identity.boardId } };
}

/** Fresh durable eligibility; neither provider input nor a cached UI snapshot grants authority. */
export async function readAuthorizedTask(storage: TaskStorage, session: SessionController, identity: ExecutionIdentity,
  metadata?: { readonly provider: LocalAgentProvider; readonly mode: 'task' | 'question'; readonly providerSessionId?: string }): Promise<CollaborationTask> {
  const current = session.getState();
  if (!current.document || current.projectId !== identity.projectId || current.branchId !== identity.branchId || current.document.id !== identity.boardId) throw new Error('Task board is no longer current');
  const opened = await TaskRepository.open(storage);
  if (!opened.ok) throw new Error(`Task storage unavailable: ${opened.code}`);
  const task = opened.repository.getSnapshot().tasks.find(value => value.id === identity.taskId);
  const attempt = task?.attempts.at(-1);
  if (!task || !attempt || task.actorId !== identity.actorId || task.scope.projectId !== identity.projectId || task.scope.branchId !== identity.branchId || task.scope.boardId !== identity.boardId || task.generation !== identity.generation || attempt.id !== identity.attemptId || attempt.generation !== identity.generation || attempt.status !== 'working' || !['working', 'waiting'].includes(task.status)) throw new Error('Task attempt is no longer authorized');
  if (metadata && (task.providerId !== metadata.provider || (task.kind === 'question' ? 'question' : 'task') !== metadata.mode || metadata.providerSessionId !== attempt.providerSessionId)) throw new Error('Agent, task mode or continuation identity changed');
  // Storage I/O can race with navigation. Never return a grant for the previous board.
  const after = session.getState();
  if (!after.document || after.projectId !== identity.projectId || after.branchId !== identity.branchId || after.document.id !== identity.boardId) throw new Error('Task board changed during authorization');
  return task;
}
