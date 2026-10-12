/**
 * Repository boot function for System Studio.
 *
 * openStudioRepository(): opens LocalRepository on Dexie `system-studio-local-v1`;
 * maps open failure (unavailable/quota) to a typed boot result, never throws raw.
 * Never touches the old `system-studio` DB.
 */

import type { Id } from '../../domain/studio/model';
import type { BuildManifestVersions } from '../../domain/studio/manifest';
import { createIssue } from '../../domain/studio/issue';
import {
  createStudioDatabase,
  DB_NAME,
  LocalRepository,
  isQuotaExceededError,
  mapErrorToFailedResult,
} from '../../persistence/studio';
import type { BootStudioRepositoryResult } from './types';

export type OpenStudioRepositoryOptions = {
  readonly mintId: () => Id;
  readonly dbName?: string;
  readonly buildVersions?: BuildManifestVersions;
};

/**
 * Opens LocalRepository on Dexie `system-studio-local-v1` (or a custom dbName for test isolation).
 * Maps open failure (unavailable/quota) to a typed boot result, never throws raw.
 * Never touches the old `system-studio` DB.
 */
export async function openStudioRepository(
  options: OpenStudioRepositoryOptions,
): Promise<BootStudioRepositoryResult> {
  if (!options || typeof options.mintId !== 'function') {
    throw new TypeError('openStudioRepository requires options.mintId function');
  }

  const dbName = options.dbName ?? DB_NAME;

  try {
    const db = createStudioDatabase(dbName);
    await db.open();

    const repository = new LocalRepository(db, {
      mintId: options.mintId,
      buildVersions: options.buildVersions,
    });

    return {
      ok: true,
      status: 'ready',
      repository,
      dispose: () => db.close(),
    };
  } catch (err) {
    if (isQuotaExceededError(err)) {
      return {
        ok: false,
        status: 'failed',
        code: 'quota',
        issues: [
          createIssue('too-large', 'Storage quota exceeded while opening database', []),
        ],
        error: err,
      };
    }

    const failedResult = mapErrorToFailedResult(err);
    const code = failedResult.code === 'quota' ? 'quota' : 'unavailable';

    return {
      ok: false,
      status: 'failed',
      code,
      issues: failedResult.issues,
      error: err,
    };
  }
}
