import type { BuildManifestResult } from '../../domain/studio/manifest';
import type { Id } from '../../domain/studio/model';
import type { Issue } from '../../domain/studio/validate';
import { createIssue } from './errors';

/**
 * The issues that explain why a scenario's manifest could not be built: readiness issues
 * re-rooted under the scenario, or one structural issue for any other non-ok status.
 */
export function manifestFailureIssues(
  scenarioId: Id,
  failure: Exclude<BuildManifestResult, { readonly status: 'ok' }>,
): Issue[] {
  if (failure.status === 'not-ready') {
    return failure.issues.map((i) =>
      createIssue(i.code as Issue['code'], i.message, ['scenarios', scenarioId, ...i.path], scenarioId),
    );
  }
  return [
    createIssue(
      'structural-rule',
      `Scenario '${scenarioId}' buildManifest failed with status '${failure.status}'`,
      ['scenarios', scenarioId],
      scenarioId,
    ),
  ];
}
