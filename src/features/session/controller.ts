import { SessionController as DomainSessionController } from '@canvas-one/system-design/session/controller';
import { mapErrorToFailedResult } from '../../persistence/studio/errors';
import type { SessionControllerOptions } from './types';
/** Application binding: storage failure classification is supplied to domain orchestration. */
export class SessionController extends DomainSessionController {
  constructor(options: SessionControllerOptions) { super({ ...options, mapError: mapErrorToFailedResult }); }
}
