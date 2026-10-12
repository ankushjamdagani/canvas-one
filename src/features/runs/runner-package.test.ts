import { describe, expect, it, vi } from 'vitest';

vi.mock('dexie', () => { throw new Error('Headless runner imported Dexie'); });
vi.mock('react', () => { throw new Error('Headless runner imported React'); });

import { RunController } from '@canvas-one/simulation-system-design/controller';
import { mintRunStartToken, validateRunStartToken } from '@canvas-one/simulation-system-design/token';
import { validateRunStartToken as validateHostToken } from '../../persistence/studio/token';
import type { HostMessage } from '@canvas-one/simulation-system-design/worker/protocol';

describe('public headless runner', () => {
  it('shares one issuer with the host and rejects copied or portable tokens', () => {
    const token = mintRunStartToken({ projectId: 'project', runId: 'run', snapshotId: 'snapshot', fingerprint: 'fingerprint', manifest: { versions: [] } });
    expect(validateRunStartToken(token)).toBe(validateHostToken(token));
    expect(Object.isFrozen(token)).toBe(true);
    expect(Object.isFrozen(token.manifest)).toBe(true);
    expect(validateRunStartToken({ ...token })).toBeNull();
    expect(validateHostToken(JSON.parse(JSON.stringify(token)))).toBeNull();
  });

  it('needs only the artifact capability and releases its transport subscription', () => {
    const unsubscribe = vi.fn();
    const dispose = vi.fn();
    const saveRun = vi.fn();
    const controller = new RunController({
      repository: { saveRun },
      mintId: () => 'run',
      transport: { postMessage: vi.fn(), onMessage: (_listener: (message: HostMessage) => void) => unsubscribe, terminate: dispose },
      clock: { now: () => 0, schedule: vi.fn(), cancel: vi.fn() },
    });
    expect(controller.getState().phase).toBe('idle');
    expect(saveRun).not.toHaveBeenCalled();
    controller.destroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
  });
});
