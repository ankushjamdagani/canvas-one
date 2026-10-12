import { PublishController as ComposablePublishController, type PublishControllerOptions as ComposableOptions } from '@canvas-one/simulation-system-design/history';
import { mapErrorToFailedResult } from '../../persistence/studio/errors';
export * from '@canvas-one/simulation-system-design/history/publish-controller';
export type PublishControllerOptions = Omit<ComposableOptions, 'mapError' | 'candidateController' | 'repository' | 'session'> & {
  readonly repository: import('../../persistence/studio').StudioRepository;
  readonly session: import('../session/controller').SessionController;
  readonly candidateController: import('../../persistence/studio/candidates').CandidateController;
};

/** Host selects storage and candidate providers; the package owns workflow state and behavior. */
export class PublishController extends ComposablePublishController {
  constructor(options: PublishControllerOptions) {
    const candidate = options.candidateController;
    super({ ...options, mapError: mapErrorToFailedResult, candidateController: {
      get: (id) => candidate.get(id),
      prepare: (_context, params) => candidate.prepare(options.repository, params),
      resolveConflict: (_context, params) => candidate.resolveConflict(options.repository, params),
      evaluate: (_context, id) => candidate.evaluate(options.repository, id),
      publish: (_context, command) => candidate.publish(options.repository, command),
    } });
  }
}
