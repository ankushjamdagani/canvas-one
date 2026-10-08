/**
 * Pure helpers wiring the run feature into the workspace shell.
 *
 * - scenario.select: a per-browser preference keyed by project + branch. A missing or
 *   deleted selection falls back to the first scenario in document order; with no
 *   scenarios there is no selection.
 * - Run is disabled while the session is saving/loading/needsReload (the
 *   configuration-draft case is handled inside RunController itself; this covers the session's
 *   own busy/needs-reload states, which RunController does not know about).
 *
 * localStorage access is isolated in read/writeScenarioSelection so Workspace never
 * touches `window.localStorage` directly and every access is wrapped in try/catch
 * (private browsing / quota / disabled storage must never throw into the UI).
 */

import type { Id } from '../../domain/studio/model';

/**
 * Per-browser preference keyed by project + branch.
 */
export function scenarioSelectionStorageKey(projectId: Id, branchId: Id): string {
  return `system-studio.scenario-selection.${projectId}.${branchId}`;
}

/**
 * Pure resolution of the effective selected scenario id from a stored preference and
 * the document's current scenario order:
 * - stored id still present -> keep it.
 * - stored id missing/deleted/null, but scenarios exist -> first scenario in document order.
 * - no scenarios -> no selection.
 */
export function resolveSelectedScenarioId(
  storedId: Id | null,
  scenarioIdsInDocumentOrder: readonly Id[],
): Id | null {
  if (scenarioIdsInDocumentOrder.length === 0) {
    return null;
  }
  if (storedId !== null && scenarioIdsInDocumentOrder.includes(storedId)) {
    return storedId;
  }
  return scenarioIdsInDocumentOrder[0];
}

/**
 * Reads the stored scenario selection preference for a project + branch.
 * Returns null on missing key or any storage failure (private browsing, disabled
 * storage, etc.) -- never throws.
 */
export function readScenarioSelection(projectId: Id, branchId: Id): Id | null {
  try {
    const value = localStorage.getItem(scenarioSelectionStorageKey(projectId, branchId));
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Persists the scenario selection preference for a project + branch.
 * Silently no-ops on storage failure -- selection still works for the current
 * session via in-memory state even if it can't be persisted.
 */
export function writeScenarioSelection(projectId: Id, branchId: Id, scenarioId: Id): void {
  try {
    localStorage.setItem(scenarioSelectionStorageKey(projectId, branchId), scenarioId);
  } catch {
    // Ignored: selection preference is a convenience, not durable state.
  }
}

/**
 * Reasons Run is disabled that come from the session layer, not from RunController
 * (which only knows about run/compile state).
 * Returns null when the session isn't blocking Run.
 */
export function computeSessionRunDisabledReason(
  status: 'empty' | 'ready' | 'saving' | 'loading',
  needsReload: boolean,
): string | null {
  if (needsReload) {
    return 'Reload the project before running';
  }
  if (status === 'saving') {
    return 'Saving…';
  }
  if (status === 'loading') {
    return 'Loading…';
  }
  return null;
}
