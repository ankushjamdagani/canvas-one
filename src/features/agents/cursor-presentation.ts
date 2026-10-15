import * as React from 'react';
import type { AgentPresence } from './AgentCursor';
import type { AgentActivity } from './activity';
import type { CollaborationTask } from '@canvas-one/agents';

export const CURSOR_APPEAR_DELAY = 200;
export const CURSOR_SUCCESS_DURATION = 700;
/** Completing an attempt fences writes by advancing the task generation. Only a
 * successful read-only receipt may survive that exact terminal transition. */
export function activityMatchesTask(activity: AgentActivity, task: Pick<CollaborationTask, 'id' | 'generation' | 'status' | 'attempts'>): boolean {
  const attempt = task.attempts.at(-1);
  if (task.id !== activity.taskId || attempt?.id !== activity.attemptId || attempt.generation !== activity.generation) return false;
  return task.status === 'completed'
    ? activity.status === 'succeeded' && attempt.status === 'finished' && task.generation === activity.generation + 1
    : (task.status === 'requested' || task.status === 'working') && task.generation === activity.generation;
}
const keyOf = (presence: AgentPresence) => {
  const a = presence.activity;
  return a ? JSON.stringify([a.taskId, a.attemptId, a.generation, a.id]) : undefined;
};

/** A single latest operation, never an animation queue. No execution is delayed. */
export class CursorPresentation {
  private value: AgentPresence | undefined;
  private current: AgentPresence | undefined;
  private key: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private completed = false;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private show(value: AgentPresence | undefined) { this.value = value; this.listeners.forEach(listener => listener()); }
  clear = () => { clearTimeout(this.timer); this.timer = undefined; this.current = undefined; this.key = undefined; this.completed = false; this.show(undefined); };
  update(presence: AgentPresence | undefined) {
    const nextKey = presence && keyOf(presence);
    if (!presence || !nextKey || presence.activity?.status === 'failed') { this.clear(); return; }
    if (nextKey !== this.key) {
      this.clear(); this.key = nextKey; this.current = presence;
      if (presence.activity?.status !== 'running') return;
      // Controller evidence can use a monotonic clock. Measure the visible delay
      // from observation rather than subtracting timestamps with another origin.
      this.timer = setTimeout(() => { this.timer = undefined; if (this.key === nextKey && this.current?.activity?.status === 'running') this.show(this.current); }, CURSOR_APPEAR_DELAY);
      return;
    }
    this.current = presence;
    if (presence.activity?.status === 'succeeded') {
      if (this.completed) return;
      this.completed = true; clearTimeout(this.timer); this.timer = undefined;
      if (!this.value) return;
      this.show(presence);
      this.timer = setTimeout(() => { this.timer = undefined; this.show(undefined); }, CURSOR_SUCCESS_DURATION);
    } else if (!this.completed && this.value) this.show(presence);
  }
}

export function useCursorPresentation(presence: AgentPresence | undefined): AgentPresence | undefined {
  const [presentation] = React.useState(() => new CursorPresentation());
  const shown = React.useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot);
  React.useLayoutEffect(() => { presentation.update(presence); }, [presentation, presence]);
  React.useEffect(() => () => presentation.clear(), [presentation]);
  // Scope removal/key changes fence stale output synchronously, before effect cleanup.
  return presence && shown && keyOf(presence) === keyOf(shown) && presence.activity?.status !== 'failed' ? shown : undefined;
}
