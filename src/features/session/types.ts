import type { LocalRepository } from '../../persistence/studio';
import type { Issue } from '../../domain/studio/validate';
export * from '@canvas-one/system-design/session/types';
export type SessionControllerOptions = Omit<import('@canvas-one/system-design/session/types').SessionControllerOptions, 'mapError'>;

export type BootStudioRepositorySuccess = {
  readonly ok: true;
  readonly status: 'ready';
  readonly repository: LocalRepository;
  readonly dispose?: () => void;
};

export type BootStudioRepositoryFailure = {
  readonly ok: false;
  readonly status: 'failed';
  readonly code: 'unavailable' | 'quota';
  readonly issues: readonly Issue[];
  readonly error?: unknown;
};

export type BootStudioRepositoryResult =
  | BootStudioRepositorySuccess
  | BootStudioRepositoryFailure;

