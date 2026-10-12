import { buildManifest, type BuildManifestVersions, type ManifestScope } from '../studio/manifest.js';
import { manifestFailureIssues } from '../studio/manifest-issues.js';
import type { Document } from '../studio/model.js';
import type { Issue } from '../studio/validate.js';

export type CandidateScenarioFingerprint = {
  readonly scenarioId: string; readonly fingerprint: string;
  readonly scope: ManifestScope;
};

/** Semantic readiness policy; execution and recorded evidence remain host capabilities. */
export async function prepareCandidateScenarios(document: Document, versions: BuildManifestVersions): Promise<
  | { readonly status: 'ready'; readonly scenarios: readonly CandidateScenarioFingerprint[] }
  | { readonly status: 'invalid'; readonly issues: readonly Issue[] }
> {
  const scenarios: CandidateScenarioFingerprint[] = [];
  for (const scenario of document.scenarios) {
    const result = await buildManifest(document, scenario.id, versions);
    if (result.status !== 'ok') return { status: 'invalid', issues: manifestFailureIssues(scenario.id, result) };
    scenarios.push({ scenarioId: scenario.id, fingerprint: result.fingerprint, scope: result.manifest.scope });
  }
  return { status: 'ready', scenarios };
}
