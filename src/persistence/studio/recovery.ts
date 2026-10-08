/**
 * Save failure recovery options helper.
 *
 * Exposes a helper describing recovery options (retry / reload / export) as data, with no UI.
 */

import type {
  SaveFailureRecoveryInfo,
  SaveFailureRecoveryOption,
} from './types';

/**
 * Returns structured recovery options as data for a failed save operation.
 * Does not perform UI operations or mutations.
 */
export function getSaveFailureRecoveryOptions(failure: unknown): SaveFailureRecoveryInfo {
  if (failure && typeof failure === 'object') {
    const f = failure as Record<string, unknown>;

    // Case 1: Stale working revision (concurrency conflict)
    if (f.status === 'stale') {
      const options: readonly SaveFailureRecoveryOption[] = [
        {
          action: 'reload',
          label: 'Reload latest',
          description: 'Discard in-memory changes and reload the latest version from storage',
          recommended: true,
        },
        {
          action: 'retry',
          label: 'Retry save',
          description: 'Re-apply working changes against the updated branch revision',
          recommended: false,
        },
        {
          action: 'export',
          label: 'Export backup',
          description: 'Export in-memory draft to a portable file to prevent losing unsaved work',
          recommended: false,
        },
      ];
      return {
        reason: 'stale',
        message: 'The working copy is stale because newer changes were saved elsewhere. Overwriting is blocked.',
        keepInMemoryCopy: true,
        options,
      };
    }

    // Case 2: Quota exceeded
    if (f.status === 'failed' && f.code === 'quota') {
      const options: readonly SaveFailureRecoveryOption[] = [
        {
          action: 'export',
          label: 'Export backup',
          description: 'Export project bundle to a portable file to prevent data loss',
          recommended: true,
        },
        {
          action: 'retry',
          label: 'Retry save',
          description: 'Retry autosave after freeing browser storage space',
          recommended: false,
        },
        {
          action: 'reload',
          label: 'Reload',
          description: 'Reload last saved state from database',
          recommended: false,
        },
      ];
      return {
        reason: 'quota',
        message: 'Storage quota exceeded. The database was not modified and your changes are kept in memory.',
        keepInMemoryCopy: true,
        options,
      };
    }

    // Case 3: Storage limit reached
    if (f.status === 'failed' && f.code === 'limit') {
      const options: readonly SaveFailureRecoveryOption[] = [
        {
          action: 'export',
          label: 'Export backup',
          description: 'Export project bundle to file to preserve work before pruning',
          recommended: true,
        },
        {
          action: 'retry',
          label: 'Retry save',
          description: 'Retry save after pruning unpinned artifacts or runs',
          recommended: false,
        },
        {
          action: 'reload',
          label: 'Reload',
          description: 'Reload last saved state from database',
          recommended: false,
        },
      ];
      return {
        reason: 'limit',
        message: 'Project storage limit reached. Prune unpinned records or export project.',
        keepInMemoryCopy: true,
        options,
      };
    }

    // Case 4: Storage unavailable
    if (f.status === 'failed' && f.code === 'unavailable') {
      const options: readonly SaveFailureRecoveryOption[] = [
        {
          action: 'retry',
          label: 'Retry save',
          description: 'Retry saving once the database becomes available',
          recommended: true,
        },
        {
          action: 'export',
          label: 'Export backup',
          description: 'Export project bundle to a portable file',
          recommended: false,
        },
        {
          action: 'reload',
          label: 'Reload',
          description: 'Reload last saved state from database',
          recommended: false,
        },
      ];
      return {
        reason: 'unavailable',
        message: 'Database is currently unavailable or blocked.',
        keepInMemoryCopy: true,
        options,
      };
    }
  }

  // Fallback for other failure reasons
  return {
    reason: 'other',
    message: 'Save failed. In-memory copy is preserved.',
    keepInMemoryCopy: true,
    options: [
      {
        action: 'retry',
        label: 'Retry save',
        description: 'Retry the save operation',
        recommended: true,
      },
      {
        action: 'export',
        label: 'Export backup',
        description: 'Export project content to file to prevent loss',
        recommended: false,
      },
      {
        action: 'reload',
        label: 'Reload',
        description: 'Reload last persisted state',
        recommended: false,
      },
    ],
  };
}
