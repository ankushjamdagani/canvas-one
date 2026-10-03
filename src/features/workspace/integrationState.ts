import type { Id } from '../../domain/studio/model';
import type { RecordChange } from '../../persistence/studio';
import type { SessionApplyResult, SessionState } from '../session/types';
import type { ScenarioDraftSession } from '../scenarios/types';
import type { TransferSessionState } from '../transfer';

type TransferSessionSource = Pick<
  SessionState,
  'projectId' | 'projectRevision' | 'document'
>;

type ScenarioSessionSource = {
  readonly getState: () => Pick<SessionState, 'workingRevision' | 'document'>;
  readonly apply: (
    changes: readonly RecordChange[],
    label: string,
  ) => Promise<SessionApplyResult>;
};

/** Projects the live workspace state into the transfer controller's narrow input. */
export function buildTransferSessionState(
  state: TransferSessionSource,
  viewId: Id | null,
  selectedSavedRunId: Id | null,
): TransferSessionState {
  return {
    projectId: state.projectId,
    projectRevision: state.projectRevision,
    document: state.document,
    viewId,
    selectedRunId: selectedSavedRunId,
  };
}

/** Adapts the live session command boundary to the scenario draft helper contract. */
export function createScenarioDraftSession(
  session: ScenarioSessionSource,
): ScenarioDraftSession {
  return {
    getState: () => {
      const state = session.getState();
      return {
        workingRevision: state.workingRevision,
        document: state.document,
      };
    },
    apply: async (changes, label) => {
      const result = await session.apply(changes, label);
      if (result.status === 'busy' || result.status === 'unsupported') {
        return { status: 'failed', code: 'unavailable', issues: [] };
      }
      return result;
    },
  };
}
