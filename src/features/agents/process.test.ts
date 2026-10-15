import { describe, expect, it, vi } from 'vitest';
import { launchManagedProcess } from '@canvas-one/agent-bridge/process';

const limits = { maxInputBytes: 4096, maxOutputBytes: 4096, cancelGraceMs: 50 };
const launch = (script: string, onOutput: (value: string) => void = () => {}, overrides = {}) => launchManagedProcess({ command: process.execPath, args: ['-e', script], cwd: process.cwd(), onOutput, onDiagnostic: () => {}, limits, ...overrides });
describe('local process boundary', () => {
  it('streams complete UTF-8 characters across split pipe chunks and sends input without a shell', async () => {
    let output = '';
    const child = launch("process.stdin.once('data', x => { const b=Buffer.from('✓ '+x); process.stdout.write(b.subarray(0,1)); setTimeout(()=>process.stdout.end(b.subarray(1)),10); });", value => { output += value; });
    child.write('$(echo unsafe)'); child.endInput();
    expect(await child.finished).toMatchObject({ code: 0 });
    expect(output).toBe('✓ $(echo unsafe)');
  });
  it('bounds output and rejects rather than reporting truncated success', async () => {
    const child = launch("process.stdout.write('x'.repeat(5000)); setInterval(()=>{},1000);");
    await expect(child.finished).rejects.toThrow('output exceeded');
    await expect(child.cancel()).resolves.toBeUndefined();
  });
  it('acknowledges cancellation only after process exit and makes it idempotent', async () => {
    const child = launch('setInterval(()=>{},1000);');
    const cancellation = child.cancel();
    expect(child.cancel()).toBe(cancellation);
    await cancellation;
    expect(await child.finished).toMatchObject({ code: null });
    expect(() => child.write('later')).toThrow('closed');
  });
  it('reports startup failures and input limits without crashing the host', async () => {
    const missing = launch('', undefined, { command: '/definitely-not-a-canvas-executable' });
    await expect(missing.finished).rejects.toThrow();
    const child = launch('setInterval(()=>{},1000);');
    expect(() => child.write('x'.repeat(5000))).toThrow('input exceeded');
    await child.cancel();
  });
  it('reports a delivery failure while still acknowledging that cancellation closed the process', async () => {
    const child = launch("process.stdout.write('output'); setInterval(()=>{},1000);", () => { throw new Error('host callback failed'); });
    await expect(child.finished).rejects.toThrow('could not be delivered');
    await expect(child.cancel()).resolves.toBeUndefined();
  });
  it('reports a signal failure asynchronously and allows an explicit cancellation retry', async () => {
    const child = launch('setInterval(()=>{},1000);');
    const originalKill = process.kill.bind(process);
    let failed = false;
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (!failed && signal === 'SIGTERM') { failed = true; throw Object.assign(new Error('Signal denied'), { code: 'EPERM' }); }
      return originalKill(pid, signal);
    });
    try {
      await expect(child.cancel()).rejects.toThrow('Signal denied');
      await expect(child.cancel()).resolves.toBeUndefined();
    } finally { kill.mockRestore(); await child.cancel(); }
  });
});
