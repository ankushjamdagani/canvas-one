import { canonicalJson } from '@canvas-one/system-design/studio/canonical';
import { buildManifest, type BuildManifestVersions } from '@canvas-one/system-design/studio/manifest';
import { manifestFailureIssues } from '@canvas-one/system-design/studio/manifest-issues';
import { createIssue } from '@canvas-one/system-design/studio/issue';
import type { Document, Id, Scenario } from '@canvas-one/system-design/studio/model';
import type { Issue } from '@canvas-one/system-design/studio/validate';
import { runQualifies, buildEvidenceManifest as buildHistoryEvidenceManifest, type CandidateScenario } from '@canvas-one/history';
import type { FailedResult, InvalidResult } from './history/contracts.js';
import { evidenceEntryFromTerminal, type EvidenceManifest, type EvidenceRef } from './runner/evidence.js';
import type { TerminalStatus } from './runner/types.js';
import type { RunRecord } from './artifacts.js';

function buildEvidenceManifest(scenarios: readonly CandidateScenario[], runs: readonly RunRecord[]): EvidenceManifest {
  return buildHistoryEvidenceManifest(scenarios, runs, (scenarioId, fingerprint, run) => evidenceEntryFromTerminal(scenarioId, fingerprint, {
    kind: 'terminal', runId: run.id, status: run.status as TerminalStatus,
    checks: run.checks, summary: run.summary, reason: null,
  }));
}
/** Evidence qualification and publication rechecks over supplied current artifacts. */
export class RepositoryEvidencePolicy {
  constructor(private readonly options: {
    readonly buildVersions: BuildManifestVersions;
    readonly loadRun: (projectId: Id, runId: Id) => Promise<RunRecord | undefined>;
  }) {}
  async recheck(
    projectId: Id,
    evidence: readonly EvidenceRef[],
    citedRuns: readonly RunRecord[],
  ): Promise<FailedResult | null> {
    const ineligible = (ref: EvidenceRef, message: string): FailedResult => ({
      status: 'failed',
      code: 'ineligible',
      issues: [createIssue('structural-rule', message, ['evidence', ref.scenarioId], ref.runId)],
    });

    for (const ref of evidence) {
      const cachedRun = citedRuns.find((r) => r.id === ref.runId);
      const curRun = await this.options.loadRun(projectId, ref.runId);
      if (!curRun || !cachedRun) {
        return ineligible(ref, `Cited evidence run '${ref.runId}' missing from database`);
      }

      const curChecks = canonicalJson(curRun.checks);
      const cachedChecks = canonicalJson(cachedRun.checks);
      if (
        curRun.fingerprint !== cachedRun.fingerprint ||
        curRun.status !== cachedRun.status ||
        curRun.provenance !== cachedRun.provenance ||
        !curChecks.ok ||
        !cachedChecks.ok ||
        curChecks.text !== cachedChecks.text
      ) {
        return ineligible(ref, `Cited evidence run '${ref.runId}' changed between evaluation and transaction`);
      }
    }
    return null;
  }


  async check(
    projectId: Id,
    doc: Document,
    evidence: readonly EvidenceRef[],
    labels: { readonly document: 'working' | 'candidate'; readonly zeroScenarios: string },
  ): Promise<
    | { readonly status: 'ok'; readonly evidenceManifest: EvidenceManifest; readonly citedRuns: RunRecord[] }
    | InvalidResult
    | FailedResult
  > {
    if (!doc.scenarios || doc.scenarios.length === 0) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            labels.zeroScenarios,
            ['scenarios'],
          ),
        ],
      };
    }

    // Evidence ref validation against working document:
    // at most one ref per scenarioId; a ref for a scenario that isn't in the working document -> invalid
    const seenScenarioIds = new Set<Id>();
    const docScenarioMap = new Map<Id, Scenario>(doc.scenarios.map((s) => [s.id, s]));
    const refValidationIssues: Issue[] = [];

    for (let i = 0; i < evidence.length; i++) {
      const ref = evidence[i];
      if (seenScenarioIds.has(ref.scenarioId)) {
        refValidationIssues.push(
          createIssue(
            'duplicate-id',
            `Duplicate evidence ref for scenario '${ref.scenarioId}'`,
            ['payload', 'evidence', i],
            ref.scenarioId,
          ),
        );
      } else {
        seenScenarioIds.add(ref.scenarioId);
      }

      if (!docScenarioMap.has(ref.scenarioId)) {
        refValidationIssues.push(
          createIssue(
            'dangling-reference',
            `Evidence ref cites scenario '${ref.scenarioId}' which does not exist in ${labels.document} document`,
            ['payload', 'evidence', i],
            ref.scenarioId,
          ),
        );
      }
    }

    if (refValidationIssues.length > 0) {
      return { status: 'invalid', issues: refValidationIssues };
    }

    // Every scenario in the document must have a ref
    const refByScenarioId = new Map<Id, EvidenceRef>();
    for (const ref of evidence) {
      refByScenarioId.set(ref.scenarioId, ref);
    }

    for (const scenario of doc.scenarios) {
      if (!refByScenarioId.has(scenario.id)) {
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              `Scenario '${scenario.id}' has no qualifying evidence run`,
              ['evidence', scenario.id],
              scenario.id,
            ),
          ],
        };
      }
    }

    // A ref whose run is missing -> failed/ineligible naming the run;
    // run.scenarioId !== ref.scenarioId or run.fingerprint !== ref.fingerprint -> failed/ineligible
    for (const ref of evidence) {
      const runRec = await this.options.loadRun(projectId, ref.runId);
      if (!runRec) {
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              `Cited evidence run '${ref.runId}' missing from database`,
              ['evidence', ref.scenarioId],
              ref.runId,
            ),
          ],
        };
      }

      // The run's scenario comes from its stored manifest; a run without one can't back a ref.
      const runScenarioId: unknown = (runRec.manifest as { scenario?: { id?: unknown } } | null)?.scenario?.id;
      if (typeof runScenarioId !== 'string' || runScenarioId !== ref.scenarioId) {
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              `Cited evidence run '${ref.runId}' scenarioId '${runScenarioId}' does not match ref scenarioId '${ref.scenarioId}'`,
              ['evidence', ref.scenarioId],
              ref.runId,
            ),
          ],
        };
      }

      if (runRec.fingerprint !== ref.fingerprint) {
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              `Cited evidence run '${ref.runId}' fingerprint '${runRec.fingerprint}' does not match ref fingerprint '${ref.fingerprint}'`,
              ['evidence', ref.scenarioId],
              ref.runId,
            ),
          ],
        };
      }
    }

    // 5. Eligibility computed OUTSIDE the transaction from the working snapshot:
    // Build manifest and fingerprint for each scenario using the repository's current build versions (never from evidence)
    // and verify that THAT ref's run qualifies (no other cited run stands in).
    const candidateScenarios: CandidateScenario[] = [];
    const citedRuns: RunRecord[] = [];

    for (const scenario of doc.scenarios) {
      const manifestRes = await buildManifest(doc, scenario.id, this.options.buildVersions);
      if (manifestRes.status !== 'ok') {
        const issues = manifestFailureIssues(scenario.id, manifestRes);
        return {
          status: 'failed',
          code: 'ineligible',
          issues,
        };
      }

      const ref = refByScenarioId.get(scenario.id)!;
      const runRec = (await this.options.loadRun(projectId, ref.runId))!;

      const qualResult = runQualifies(runRec, {
        scenarioId: scenario.id,
        fingerprint: manifestRes.fingerprint,
        compiledScopeElementIds: manifestRes.manifest.scope.includedElementIds,
      });

      if (!qualResult.qualifies) {
        const message =
          runRec.status === 'incomplete'
            ? `Scenario '${scenario.id}' evidence run is incomplete`
            : `Scenario '${scenario.id}' evidence run is not qualifying: ${qualResult.reasons.join(', ')}`;
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              message,
              ['evidence', scenario.id],
              scenario.id,
            ),
          ],
        };
      }

      candidateScenarios.push({
        scenarioId: scenario.id,
        fingerprint: manifestRes.fingerprint,
        scope: manifestRes.manifest.scope,
      });
      citedRuns.push(runRec);
    }


    return { status: 'ok', evidenceManifest: buildEvidenceManifest(candidateScenarios, citedRuns), citedRuns };
  }

}
