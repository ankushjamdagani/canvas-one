import { HistoryController as ComposableHistoryController } from '@canvas-one/simulation-system-design/history';
import { mapErrorToFailedResult } from '../../persistence/studio/errors';
import type { HistoryControllerOptions } from './types';
export * from '@canvas-one/simulation-system-design/history/controller';

/** Host binds its storage error policy; history mechanics live in the optional composition. */
export class HistoryController extends ComposableHistoryController {
  constructor(options: HistoryControllerOptions) {
    super({ ...options, mapError: mapErrorToFailedResult, workingEditsNotice: 'This session only: uncommitted edit history resets upon session reload' });
  }
}
