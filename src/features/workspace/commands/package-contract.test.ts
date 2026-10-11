import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry, executeAvailable } from '@canvas-one/commands';

function setup() {
  const registry = new CommandRegistry<{ enabled: boolean }>();
  const handler = vi.fn((payload: string) => payload.toUpperCase());
  const registration = registry.register({
    metadata: { id: 'test.echo', label: 'Echo', effect: 'query' },
    validate: (input: unknown) => typeof input === 'string'
      ? { valid: true as const, value: input }
      : { valid: false as const, reason: 'Expected text' },
    availability: (context) => context.enabled
      ? { enabled: true as const }
      : { enabled: false as const, reason: 'Closed', code: 'closed' },
    execute: handler,
  });
  return { registry, handler, registration };
}

describe('headless command registration contract', () => {
  it('validates unknown input and checks execution-time availability', async () => {
    const { registry, handler } = setup();
    registry.discover();
    await expect(registry.execute('test.echo', 7, { enabled: true })).rejects.toMatchObject({ code: 'invalid-payload' });
    expect(await registry.execute('test.echo', 'hello', { enabled: false })).toEqual({ status: 'disabled', reason: 'Closed', code: 'closed' });
    expect(handler).not.toHaveBeenCalled();
    expect(await registry.execute('test.echo', 'hello', { enabled: true })).toEqual({ status: 'done', value: 'HELLO' });
  });

  it('rejects duplicates and makes disposal idempotent without removing a replacement', async () => {
    const { registry, registration } = setup();
    const definition = {
      metadata: { id: 'test.echo', label: 'Replacement', effect: 'query' as const },
      validate: () => ({ valid: true as const, value: null }),
      availability: () => ({ enabled: true as const }),
      execute: () => 'replacement',
    };
    expect(() => registry.register(definition)).toThrow('already registered');
    registration.dispose();
    registry.register(definition);
    registration.dispose();
    expect(await registry.execute('test.echo', null, { enabled: true })).toMatchObject({ value: 'replacement' });
    registry.dispose();
    await expect(registry.execute('test.echo', null, { enabled: true })).rejects.toMatchObject({ code: 'unknown' });
  });

  it('isolates discoveries and registries', () => {
    const { registry } = setup();
    const discoveries = registry.discover();
    (discoveries[0] as { label: string }).label = 'Modified';
    expect(registry.discover()[0].label).toBe('Echo');
    expect(new CommandRegistry().discover()).toEqual([]);
  });

  it('rejects non-JSON metadata and prevents already-cancelled execution', async () => {
    const { registry, handler } = setup();
    expect(() => registry.register({
      metadata: { id: 'test.invalid', label: 'Invalid', effect: 'query', details: NaN },
      validate: () => ({ valid: true, value: null }),
      availability: () => ({ enabled: true }),
      execute: () => undefined,
    })).toThrow('JSON-safe');
    await expect(registry.execute('test.echo', 'hello', { enabled: true }, { signal: { aborted: true } })).rejects.toMatchObject({ code: 'cancelled' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes cancellation to handlers and preserves handler failures', async () => {
    const signal = { aborted: false };
    const registry = new CommandRegistry();
    registry.register({
      metadata: { id: 'test.signal', label: 'Signal', effect: 'session' },
      validate: () => ({ valid: true, value: null }),
      availability: () => ({ enabled: true }),
      execute: (_payload, _context, execution) => execution.signal,
    });
    expect(await registry.execute('test.signal', null, undefined, { signal })).toEqual({ status: 'done', value: signal });
    const failure = new Error('Storage failed');
    await expect(executeAvailable(() => ({ enabled: true }), () => { throw failure; })).rejects.toBe(failure);
  });
});
