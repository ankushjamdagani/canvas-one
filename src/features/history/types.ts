export * from '@canvas-one/simulation-system-design/history/types';
export type HistoryControllerOptions = {
  readonly repository: import('../../persistence/studio').StudioRepository;
  readonly session: import('../session/controller').SessionController;
  readonly mintId: () => string;
  readonly actor: import('../../persistence/studio').Actor;
};
