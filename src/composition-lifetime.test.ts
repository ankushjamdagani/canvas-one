import { describe, expect, it, vi } from 'vitest';
import { createCompositionLifetime } from '../apps/web/src/composition-lifetime';

describe('application composition leases', () => {
  it('rejects a late repository boot after teardown and releases its explicit ownership lease', async () => {
    const lifetime = createCompositionLifetime(); const token = lifetime.begin(); const close = vi.fn();
    let finish!: () => void; const pending = new Promise<void>(resolve => {finish = resolve;});
    const boot = pending.then(() => lifetime.adopt(token, close));
    lifetime.dispose(); finish();
    expect(await boot).toBe(false); expect(close).toHaveBeenCalledOnce();
  });
  it('disposes owned resources once and allows Strict Mode setup to acquire a fresh generation', () => {
    const lifetime = createCompositionLifetime(); const first = vi.fn(); const second = vi.fn();
    lifetime.adopt(lifetime.begin(), first); lifetime.dispose(); lifetime.dispose();
    expect(first).toHaveBeenCalledOnce();
    lifetime.activate(); lifetime.adopt(lifetime.begin(), second);
    expect(second).not.toHaveBeenCalled(); lifetime.dispose(); expect(second).toHaveBeenCalledOnce();
  });
  it('does not close a shared repository without an explicit ownership disposer', () => {
    const lifetime = createCompositionLifetime(); const sharedClose = vi.fn(); const sessionDispose = vi.fn();
    const sharedRepository = {close: sharedClose};
    lifetime.adopt(lifetime.begin(), () => sessionDispose()); lifetime.dispose();
    expect(sessionDispose).toHaveBeenCalledOnce(); expect(sharedRepository.close).not.toHaveBeenCalled();
  });
});
