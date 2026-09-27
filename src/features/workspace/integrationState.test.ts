import { describe, expect, it, vi } from 'vitest';
import type { Document } from '../../domain/studio/model';
import { buildTransferSessionState, createScenarioDraftSession } from './integrationState';

describe('workspace integration state', () => {
  it('passes an explicitly selected saved run to transfer actions and preserves no selection', () => {
    const document = { views: [] } as unknown as Document;
    const source = { projectId: 'project-1', projectRevision: 3, document };

    expect(buildTransferSessionState(source, 'view-1', null)).toEqual({
      projectId: 'project-1',
      projectRevision: 3,
      document,
      viewId: 'view-1',
      selectedRunId: null,
    });
    expect(buildTransferSessionState(source, 'view-1', 'run-1').selectedRunId).toBe('run-1');
  });

  it('adapts busy session writes to the scenario draft unavailable result', async () => {
    const session = {
      getState: () => ({ workingRevision: 2, document: null }),
      apply: vi.fn().mockResolvedValue({
        status: 'busy',
        message: 'An operation is currently in flight',
      }),
    };
    const adapter = createScenarioDraftSession(session);

    await expect(adapter.apply([], 'Edit scenario')).resolves.toEqual({
      status: 'failed',
      code: 'unavailable',
      issues: [],
    });
  });
});
