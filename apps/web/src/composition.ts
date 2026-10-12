/** The application selects implementations; feature interfaces receive composed services. */
import { openStudioRepository, SessionController } from '../../../src/features/session/index';
import type { OpenStudioRepositoryOptions } from '../../../src/features/session/boot';
import type { SessionControllerOptions, BootStudioRepositoryResult } from '../../../src/features/session/types';
import { HistoryController } from '../../../src/features/history/controller';
import { PublishController } from '../../../src/features/history/publishController';
import type { Actor, StudioRepository } from '../../../src/persistence/studio/types';
import { createCandidateController } from '../../../src/persistence/studio/index';
import { WorkerTransport, type RunTransport } from '@canvas-one/simulation-system-design/worker/transport';
import type { RunController } from '@canvas-one/simulation-system-design/controller';
import { mapErrorToFailedResult } from '../../../src/persistence/studio/errors';
import type { ModelProvider } from '@canvas-one/agents';
import type { SystemDesignPresentation } from '@canvas-one/system-design/react';
import type { PaletteCommandContribution } from '@canvas-one/commands';
import type { CommandContext } from '../../../src/features/workspace/commands/registry';
import type {ComponentType, RefAttributes} from 'react';
import type {CanvasViewProps, CanvasViewHandle} from '../../../src/features/workspace/CanvasView';

/** Product host contract is neutral; another engine supplies its own presentation and gesture binding. */
export type StudioCanvasHost = ComponentType<CanvasViewProps & RefAttributes<CanvasViewHandle>>;

export type RepositoryBootResult = Exclude<BootStudioRepositoryResult, {ok: true}>
  | {readonly ok: true; readonly status: 'ready'; readonly repository: StudioRepository; readonly dispose?: () => void};
export type WorkspaceCompositionOptions = {readonly repository: StudioRepository; readonly session: SessionController; readonly mintId: () => string; readonly actor: Actor};
export type RunLease = {readonly controller: RunController; dispose(): void};
export interface StudioComposition {
  readonly openRepository: (options: OpenStudioRepositoryOptions) => Promise<RepositoryBootResult>;
  readonly createSession: (options: SessionControllerOptions) => SessionController;
  readonly createVersioning: (options: WorkspaceCompositionOptions) => {
    readonly historyController: HistoryController;
    readonly candidateController: ReturnType<typeof createCandidateController>;
    readonly publishController: PublishController;
  };
  readonly createExecution: (options: Pick<WorkspaceCompositionOptions, 'repository' | 'mintId'>) => Promise<RunLease>;
  readonly modelProvider?: ModelProvider;
  readonly extensions?: readonly import('@canvas-one/whiteboard').ExtensionDefinition[];
  readonly createCommandContributions?: (options: {readonly session: SessionController}) => readonly PaletteCommandContribution<CommandContext>[];
  readonly systemDesignPresentation?: SystemDesignPresentation;
  readonly createSystemDesignPresentation?: (options: {readonly session: SessionController}) => SystemDesignPresentation;
  readonly canvasHost?: StudioCanvasHost;
}
export function createStudioComposition(overrides: Partial<StudioComposition> & {readonly createTransport?: () => RunTransport} = {}): StudioComposition {
  return {
    openRepository: openStudioRepository,
    createSession: options => new SessionController({ ...options, extensions: options.extensions ?? overrides.extensions }),
    createVersioning: options => {
      const candidateController = createCandidateController({mintId: options.mintId});
      return {
        historyController: new HistoryController(options),
        candidateController,
        publishController: new PublishController({...options, candidateController,
          runScenario: params => candidateController.startCandidateRun(options.repository, params)}),
      };
    },
    createExecution: async options => {
      const {RunController} = await import('@canvas-one/simulation-system-design/controller');
      const transport = overrides.createTransport?.() ?? new WorkerTransport(new Worker(
        new URL('../../../src/features/runs/runner.worker.ts', import.meta.url), {type: 'module'},
      ));
      const controller = new RunController({...options, transport, mapSaveError: mapErrorToFailedResult});
      return {controller, dispose: () => {controller.destroy(); transport.terminate?.();}};
    },
    ...overrides,
  };
}
export const defaultStudioComposition = createStudioComposition();
