import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPresence } from './AgentCursor';
import { activityMatchesTask, CursorPresentation } from './cursor-presentation';
const presence = (id = 'one', status: 'running' | 'succeeded' | 'failed' = 'running', generation = 1): AgentPresence => ({
  providerLabel: 'Claude', phase: 'reading', targetIds: ['node'],
  activity: { id, taskId: 'task', attemptId: 'attempt', generation, kind: 'reading', targetIds: ['node'], status, label: status === 'succeeded' ? 'Read Checkout' : 'Reading Checkout…', startedAt: 0 },
});
describe('latest operation canvas presentation', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());
  it('never flashes an operation that completes before 200ms', () => {
    const p = new CursorPresentation(); p.update(presence());
    vi.advanceTimersByTime(199); expect(p.getSnapshot()).toBeUndefined();
    p.update(presence('one', 'succeeded')); vi.advanceTimersByTime(1000);
    expect(p.getSnapshot()).toBeUndefined();
  });
  it('uses observation time when activity has a different monotonic clock origin', () => {
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    const p = new CursorPresentation();
    const monotonicActivity = { ...presence(), activity: { ...presence().activity!, startedAt: 420.25 } };
    p.update(monotonicActivity); vi.advanceTimersByTime(199);
    expect(p.getSnapshot()).toBeUndefined();
    p.update({ ...monotonicActivity, activity: { ...monotonicActivity.activity, label: 'Reading another field…' } });
    vi.advanceTimersByTime(1);
    expect(p.getSnapshot()?.activity?.label).toBe('Reading another field…');
  });
  it('shows running at 200ms and truthful completion for exactly 700ms', () => {
    const p = new CursorPresentation(); p.update(presence()); vi.advanceTimersByTime(200);
    expect(p.getSnapshot()?.activity?.status).toBe('running');
    p.update(presence('one', 'succeeded')); vi.advanceTimersByTime(699);
    expect(p.getSnapshot()?.activity?.label).toBe('Read Checkout');
    p.update(presence('one', 'succeeded')); vi.advanceTimersByTime(1);
    expect(p.getSnapshot()).toBeUndefined();
  });
  it('latest action replaces old timers without replaying previous positions', () => {
    const p = new CursorPresentation(); p.update(presence()); vi.advanceTimersByTime(100);
    p.update({ ...presence('two'), activity: { ...presence('two').activity!, startedAt: 100 } });
    vi.advanceTimersByTime(100); expect(p.getSnapshot()).toBeUndefined();
    vi.advanceTimersByTime(100); expect(p.getSnapshot()?.activity?.id).toBe('two');
  });
  it('clears immediately on scope removal, failure and visibility loss', () => {
    for (const next of [undefined, presence('one', 'failed')]) {
      const p = new CursorPresentation(); p.update(presence()); vi.advanceTimersByTime(200);
      p.update(next); expect(p.getSnapshot()).toBeUndefined();
      vi.advanceTimersByTime(1000); expect(p.getSnapshot()).toBeUndefined();
    }
  });
  it('does not introduce a cursor from a late success or revive ended running callbacks', () => {
    const p = new CursorPresentation(); p.update(presence('one', 'succeeded'));
    expect(p.getSnapshot()).toBeUndefined();
    p.update(presence('two')); vi.advanceTimersByTime(200); p.update(presence('two', 'succeeded'));
    p.update(presence('two')); expect(p.getSnapshot()?.activity?.status).toBe('succeeded');
    vi.advanceTimersByTime(700); expect(p.getSnapshot()).toBeUndefined();
  });
  it('treats an attempt generation change as a new identity', () => {
    const p = new CursorPresentation(); p.update(presence()); vi.advanceTimersByTime(200);
    p.update({ ...presence('one', 'running', 2), activity: { ...presence('one', 'running', 2).activity!, startedAt: 200 } });
    expect(p.getSnapshot()).toBeUndefined(); vi.advanceTimersByTime(200);
    expect(p.getSnapshot()?.activity?.generation).toBe(2);
    p.clear(); vi.advanceTimersByTime(1000); expect(p.getSnapshot()).toBeUndefined();
  });
  it('cancels both delayed appearance and completion on Stop or departure', () => {
    const p = new CursorPresentation(); p.update(presence()); vi.advanceTimersByTime(100);
    p.update(undefined); vi.advanceTimersByTime(200); expect(p.getSnapshot()).toBeUndefined();
    p.update(presence('next')); vi.advanceTimersByTime(200); p.update(presence('next', 'succeeded'));
    expect(p.getSnapshot()?.activity?.status).toBe('succeeded');
    p.update(undefined); expect(p.getSnapshot()).toBeUndefined();
    vi.advanceTimersByTime(700); expect(p.getSnapshot()).toBeUndefined();
  });
  it('permits a successful receipt through only its exact completed generation', () => {
    const activity = presence('one', 'succeeded').activity!;
    const task = { id: 'task', generation: 2, status: 'completed' as const, attempts: [{ id: 'attempt', generation: 1, status: 'finished' as const, cancellation: 'none' as const }] };
    expect(activityMatchesTask(activity, task)).toBe(true);
    expect(activityMatchesTask({ ...activity, status: 'running' }, task)).toBe(false);
    expect(activityMatchesTask(activity, { ...task, status: 'stopped' })).toBe(false);
    expect(activityMatchesTask(activity, { ...task, status: 'waiting' })).toBe(false);
    expect(activityMatchesTask(activity, { ...task, generation: 3 })).toBe(false);
    expect(activityMatchesTask(activity, { ...task, attempts: [{ ...task.attempts[0]!, id: 'new-attempt' }] })).toBe(false);
    expect(activityMatchesTask(activity, { ...task, attempts: [{ ...task.attempts[0]!, generation: 2 }] })).toBe(false);
  });
});
