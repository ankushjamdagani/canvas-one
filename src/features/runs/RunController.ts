import { RunController as HeadlessRunController, type RunControllerOptions } from '@canvas-one/simulation-system-design/controller';
import { mapErrorToFailedResult } from '../../persistence/studio/errors';

export * from '@canvas-one/simulation-system-design/controller';

/** App binding supplies the existing database error policy to the headless controller. */
export class RunController extends HeadlessRunController {
  constructor(options: RunControllerOptions) {
    super({ ...options, mapSaveError: options.mapSaveError ?? mapErrorToFailedResult });
  }
}
