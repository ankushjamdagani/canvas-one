import { describe, expect, it } from 'vitest';
import { BrowserTaskLeaseRegistry } from '@canvas-one/agents';
const scope = { projectId: 'project', branchId: 'branch', boardId: 'board' };
const binding = { taskId: 'task', attemptId: 'attempt', actorId: 'claude', generation: 1, scope };
function setup(maxActiveEntries = 3, maxTombstones = 10) {
  let now = 0;
  return { registry: new BrowserTaskLeaseRegistry(() => now, { maxActiveEntries, maxTombstones }), setTime: (value: number) => { now = value; } };
}
describe('trusted browser task liveness', () => {
  it('retains a Stop fence that arrives before the first launch lease', () => {
    const { registry } = setup();
    expect(registry.revoke(binding)).toEqual({ ok: true, deadline: 0 });
    expect(registry.begin(binding, 0, 100)).toEqual({ ok: false, code: 'stale-binding' });
    const newer = { ...binding, attemptId: 'new', generation: 2 };
    expect(registry.begin(newer, 0, 100).ok).toBe(true);
    expect(registry.revoke(binding)).toEqual({ ok: false, code: 'stale-binding' });
    expect(registry.permits(newer)).toBe(true);
  });
  it('deducts heartbeat RTT rather than extending from response arrival', () => {
    const { registry, setTime } = setup(); setTime(80);
    expect(registry.begin(binding, 0, 100)).toEqual({ ok: true, deadline: 100 });
    setTime(99); expect(registry.permits(binding)).toBe(true);
    setTime(100); expect(registry.permits(binding)).toBe(false);
  });
  it('does not revive expired authority from heartbeat acknowledgements or retrying the same generation', () => {
    const { registry, setTime } = setup(); registry.begin(binding, 0, 100); setTime(100);
    expect(registry.renew(binding, 90, 100)).toEqual({ ok: false, code: 'expired' });
    expect(registry.begin(binding, 100, 100)).toEqual({ ok: false, code: 'stale-binding' });
    expect(registry.begin({ ...binding, attemptId: 'new', generation: 2 }, 100, 100).ok).toBe(true);
  });
  it('rejects stale heartbeat acknowledgements after Stop and explicit Resume', () => {
    const { registry } = setup(); registry.begin(binding, 0, 100); registry.revoke(binding);
    expect(registry.renew(binding, 0, 100)).toEqual({ ok: false, code: 'revoked' });
    const resumed = { ...binding, attemptId: 'resumed', generation: 2 };
    registry.begin(resumed, 0, 100);
    expect(registry.renew(binding, 0, 100)).toEqual({ ok: false, code: 'stale-binding' });
    expect(registry.revoke(binding)).toEqual({ ok: false, code: 'stale-binding' }); expect(registry.permits(resumed)).toBe(true);
  });
  it('binds immutable scope and actor and refuses cross-task attempt reuse', () => {
    const { registry } = setup(); const mutable = { ...binding, scope: { ...scope } }; registry.begin(mutable, 0, 100); mutable.scope.boardId = 'changed';
    expect(registry.permits(binding)).toBe(true); expect(registry.permits(mutable)).toBe(false);
    expect(registry.renew({ ...binding, actorId: 'codex' }, 0, 100)).toEqual({ ok: false, code: 'actor-mismatch' });
    expect(registry.begin({ ...binding, attemptId: 'new', generation: 2, scope: { ...scope, branchId: 'other' } }, 0, 100)).toEqual({ ok: false, code: 'scope-mismatch' });
    expect(registry.begin({ ...binding, taskId: 'other' }, 0, 100)).toEqual({ ok: false, code: 'stale-binding' });
  });
  it('fails closed permanently on a backward or invalid clock', () => {
    const { registry, setTime } = setup(); registry.begin(binding, 0, 100); setTime(50); expect(registry.permits(binding)).toBe(true);
    setTime(49); expect(registry.permits(binding)).toBe(false);
    setTime(60); expect(registry.renew(binding, 60, 100)).toEqual({ ok: false, code: 'clock-invalid' });
    expect(registry.begin({ ...binding, generation: 2, attemptId: 'new' }, 60, 100)).toEqual({ ok: false, code: 'clock-invalid' });
  });
  it('bounds live leases and retains tombstones rather than silently discarding fences', () => {
    const { registry } = setup(1, 2); registry.begin(binding, 0, 100);
    const other = { ...binding, taskId: 'other', attemptId: 'other' };
    expect(registry.begin(other, 0, 100)).toEqual({ ok: false, code: 'capacity' }); registry.revoke(binding);
    expect(registry.begin(other, 0, 100).ok).toBe(true); registry.revoke(other);
    expect(registry.begin({ ...binding, taskId: 'third', attemptId: 'third' }, 0, 100)).toEqual({ ok: false, code: 'capacity' });
    expect(registry.begin(binding, 0, 100)).toEqual({ ok: false, code: 'stale-binding' });
  });
  it('rejects future/invalid deadlines and out-of-order heartbeat ACKs while using request-time renewal', () => {
    const { registry, setTime } = setup(); expect(registry.begin(binding, 1, 100)).toEqual({ ok: false, code: 'invalid-input' });
    registry.begin(binding, 0, 100); setTime(80); expect(registry.renew(binding, 70, 100)).toEqual({ ok: true, deadline: 170 });
    expect(registry.renew(binding, 60, 100)).toEqual({ ok: false, code: 'stale-binding' });
    expect(registry.renew(binding, 90, 100)).toEqual({ ok: false, code: 'invalid-input' });
    setTime(170); expect(registry.permits(binding)).toBe(false);
  });
  it('revokes only the departed board scope and disposes only at host departure', () => {
    const { registry } = setup(); registry.begin(binding, 0, 100);
    const other = { ...binding, taskId: 'other', attemptId: 'other', scope: { ...scope, boardId: 'other' } }; registry.begin(other, 0, 100);
    registry.revokeScope(scope); expect(registry.permits(binding)).toBe(false); expect(registry.permits(other)).toBe(true);
    registry.dispose(); expect(registry.permits(other)).toBe(false); expect(registry.renew(other, 0, 100)).toEqual({ ok: false, code: 'disposed' });
  });
});
