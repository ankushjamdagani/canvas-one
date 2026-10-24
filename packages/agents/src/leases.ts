import type { AttemptBinding, TaskScope } from './tasks.js';

export type BrowserLeaseError = 'invalid-input' | 'stale-binding' | 'expired' | 'revoked' | 'capacity' | 'clock-invalid' | 'disposed' | 'scope-mismatch' | 'actor-mismatch';
export type BrowserLeaseResult = { readonly ok: true; readonly deadline: number } | { readonly ok: false; readonly code: BrowserLeaseError };
type Tombstone = { readonly binding: AttemptBinding; readonly outcome: 'live' | 'revoked' | 'expired' };
type Lease = { readonly binding: AttemptBinding; readonly deadline: number; readonly requestStartedAt: number };
const fail = (code: BrowserLeaseError): BrowserLeaseResult => ({ ok: false, code });
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const scopeValid = (scope: TaskScope) => !!scope && typeof scope === 'object' && !Array.isArray(scope) && text(scope.projectId) && text(scope.branchId) && text(scope.boardId);
const sameScope = (a: TaskScope, b: TaskScope) => a.projectId === b.projectId && a.branchId === b.branchId && a.boardId === b.boardId;
const bindingValid = (value: AttemptBinding) => !!value && typeof value === 'object' && !Array.isArray(value) && text(value.taskId) && text(value.attemptId) && text(value.actorId) && scopeValid(value.scope) && Number.isSafeInteger(value.generation) && value.generation >= 1;
const same = (a: AttemptBinding, b: AttemptBinding) => a.taskId === b.taskId && a.attemptId === b.attemptId && a.actorId === b.actorId && a.generation === b.generation && sameScope(a.scope, b.scope);
const captured = (binding: AttemptBinding): AttemptBinding => Object.freeze({ ...binding, scope: Object.freeze({ ...binding.scope }) });

/**
 * Trusted browser-session liveness only. Authenticated heartbeat acknowledgements call renew;
 * provider traffic must never call it. Check permits synchronously inside the authored authority.
 * The host still must prove transaction cutoff; this registry neither persists nor writes boards.
 */
export class BrowserTaskLeaseRegistry {
  private readonly active = new Map<string, Lease>();
  private readonly tasks = new Map<string, Tombstone>();
  private readonly attempts = new Set<string>();
  private previousTime = -Infinity;
  private brokenClock = false;
  private disposed = false;
  private readonly limits: { readonly maxActiveEntries: number; readonly maxTombstones: number };
  constructor(private readonly now: () => number, limits: { readonly maxActiveEntries: number; readonly maxTombstones: number }) {
    if (!Number.isSafeInteger(limits.maxActiveEntries) || limits.maxActiveEntries < 1 || !Number.isSafeInteger(limits.maxTombstones) || limits.maxTombstones < limits.maxActiveEntries) throw new RangeError('Explicit bounded lease limits required');
    this.limits = Object.freeze({ ...limits });
  }
  private time(): number | null {
    if (this.brokenClock) return null;
    let value: number;
    try { value = this.now(); } catch { value = NaN; }
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || value < this.previousTime) {
      this.brokenClock = true;
      for (const [id, lease] of this.active) this.tasks.set(id, { binding: lease.binding, outcome: 'revoked' });
      this.active.clear(); return null;
    }
    this.previousTime = value; return value;
  }
  private preflight(binding: AttemptBinding): BrowserLeaseError | null {
    if (this.disposed) return 'disposed';
    if (!bindingValid(binding)) return 'invalid-input';
    const prior = this.tasks.get(binding.taskId);
    if (prior && !sameScope(prior.binding.scope, binding.scope)) return 'scope-mismatch';
    if (prior && prior.binding.actorId !== binding.actorId) return 'actor-mismatch';
    return null;
  }
  private deadline(requestStartedAt: number, leaseMs: number, now: number): number | null {
    if (!Number.isFinite(requestStartedAt) || requestStartedAt < 0 || requestStartedAt > now || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || requestStartedAt + leaseMs > Number.MAX_SAFE_INTEGER) return null;
    return requestStartedAt + leaseMs;
  }
  private expire(now: number): void {
    for (const [id, lease] of this.active) if (now >= lease.deadline) {
      this.active.delete(id); this.tasks.set(id, { binding: lease.binding, outcome: 'expired' });
    }
  }
  /** Explicit new durable task authorization; replaces an earlier generation's authority immediately. */
  begin(binding: AttemptBinding, requestStartedAt: number, leaseMs: number): BrowserLeaseResult {
    const invalid = this.preflight(binding); if (invalid) return fail(invalid);
    const now = this.time(); if (now === null) return fail('clock-invalid'); this.expire(now);
    const deadline = this.deadline(requestStartedAt, leaseMs, now); if (deadline === null) return fail('invalid-input');
    const previous = this.tasks.get(binding.taskId);
    if (previous && binding.generation <= previous.binding.generation || this.attempts.has(binding.attemptId)) return fail('stale-binding');
    // Refuse new authority when tombstones fill. Never evict a fence to make room for it.
    if ((!previous && this.tasks.size >= this.limits.maxTombstones) || this.attempts.size >= this.limits.maxTombstones || (!this.active.has(binding.taskId) && this.active.size >= this.limits.maxActiveEntries)) return fail('capacity');
    const identity = captured(binding); this.attempts.add(identity.attemptId);
    this.tasks.set(identity.taskId, { binding: identity, outcome: deadline <= now ? 'expired' : 'live' });
    this.active.delete(identity.taskId);
    if (deadline <= now) return fail('expired');
    this.active.set(identity.taskId, { binding: identity, deadline, requestStartedAt });
    return { ok: true, deadline };
  }
  /** Only an authenticated heartbeat ACK for this exact still-live attempt may renew it. */
  renew(binding: AttemptBinding, requestStartedAt: number, leaseMs: number): BrowserLeaseResult {
    const invalid = this.preflight(binding); if (invalid) return fail(invalid);
    const now = this.time(); if (now === null) return fail('clock-invalid'); this.expire(now);
    const prior = this.tasks.get(binding.taskId);
    if (!prior || !same(prior.binding, binding)) return fail('stale-binding');
    const current = this.active.get(binding.taskId);
    if (!current) return fail(prior.outcome === 'expired' ? 'expired' : 'revoked');
    const deadline = this.deadline(requestStartedAt, leaseMs, now); if (deadline === null) return fail('invalid-input');
    if (requestStartedAt < current.requestStartedAt) return fail('stale-binding');
    if (deadline <= now) return fail('expired');
    this.active.set(binding.taskId, { binding: current.binding, deadline, requestStartedAt });
    return { ok: true, deadline };
  }
  permits(binding: AttemptBinding): boolean {
    if (this.preflight(binding)) return false;
    const now = this.time(); if (now === null) return false; this.expire(now);
    const lease = this.active.get(binding.taskId); return !!lease && same(lease.binding, binding);
  }
  revoke(binding: AttemptBinding): BrowserLeaseResult {
    const invalid = this.preflight(binding); if (invalid) return fail(invalid);
    const prior = this.tasks.get(binding.taskId);
    if (prior && !same(prior.binding, binding) && binding.generation <= prior.binding.generation) return fail('stale-binding');
    // Stop can win before launch installs its first lease. Retain that fence so
    // a delayed begin for this same attempt cannot manufacture new authority.
    if (!prior || !same(prior.binding, binding)) {
      if ((!prior && this.tasks.size >= this.limits.maxTombstones) || (!this.attempts.has(binding.attemptId) && this.attempts.size >= this.limits.maxTombstones)) return fail('capacity');
      if (this.attempts.has(binding.attemptId)) return fail('stale-binding');
      const identity = captured(binding); this.attempts.add(identity.attemptId);
      this.active.delete(binding.taskId); this.tasks.set(binding.taskId, { binding: identity, outcome: 'revoked' });
      return { ok: true, deadline: 0 };
    }
    const deadline = this.active.get(binding.taskId)?.deadline ?? 0;
    this.active.delete(binding.taskId); this.tasks.set(binding.taskId, { binding: prior.binding, outcome: 'revoked' });
    return { ok: true, deadline };
  }
  revokeScope(scope: TaskScope): boolean {
    if (this.disposed || !scopeValid(scope)) return false;
    for (const lease of this.active.values()) if (sameScope(lease.binding.scope, scope)) this.revoke(lease.binding);
    return true;
  }
  /** Host departure, not minimizing/closing the conversation panel. */
  dispose(): void {
    for (const lease of this.active.values()) this.revoke(lease.binding);
    this.disposed = true;
  }
}
