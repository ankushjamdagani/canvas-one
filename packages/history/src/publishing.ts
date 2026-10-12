import type { HistoryCommandEnvelope } from './versioning.js';
import type { PublicationMetadata } from './records.js';
import { validatePublicationMetadata, type PublicationIssue } from './publication.js';

export type HistoryPublishPayload<Evidence> = {
  readonly candidateId: string; readonly publicationId: string; readonly mergeCommitId: string;
  readonly metadata: PublicationMetadata; readonly evidence: readonly Evidence[];
  readonly keepSourceOpen?: boolean; readonly expectedProjectRevision: number;
};
export type HistoryPublishCommand<Actor, Evidence> = HistoryCommandEnvelope<Actor> & {
  readonly commandId: 'history.publish'; readonly payload: HistoryPublishPayload<Evidence>;
};
export type PublicationPorts<Actor, Evidence, Result> = {
  readonly actor: Actor;
  readonly mintId: () => string;
  /** Host supplies candidate/evidence policy and atomic CAS publication implementation. */
  readonly publishCandidate: (command: HistoryPublishCommand<Actor, Evidence>) => Promise<Result>;
  readonly invalid: (issues: readonly PublicationIssue[]) => Result;
};

/** Version publication transaction builder; independent of simulation policy, storage implementation and UI. */
export class PublicationService<Actor, Evidence, Result> {
  constructor(private readonly ports: PublicationPorts<Actor, Evidence, Result>) {}

  async publish(input: {
    readonly candidateId: string; readonly projectId: string; readonly sourceBranchId: string;
    readonly expectedWorkingRevision: number; readonly expectedProjectRevision: number;
    readonly metadata: PublicationMetadata; readonly evidence: readonly Evidence[]; readonly keepSourceOpen?: boolean;
  }): Promise<{ readonly publicationId: string | null; readonly result: Result }> {
    const issues = validatePublicationMetadata(input.metadata);
    if (issues.length) return { publicationId: null, result: this.ports.invalid(issues) };
    const publicationId = this.ports.mintId();
    const mergeCommitId = this.ports.mintId();
    const result = await this.ports.publishCandidate({
      commandId: 'history.publish', operationId: this.ports.mintId(), projectId: input.projectId,
      branchId: input.sourceBranchId, expectedWorkingRevision: input.expectedWorkingRevision, actor: this.ports.actor,
      payload: { candidateId: input.candidateId, publicationId, mergeCommitId, metadata: input.metadata,
        evidence: input.evidence, expectedProjectRevision: input.expectedProjectRevision,
        ...(input.keepSourceOpen === undefined ? {} : { keepSourceOpen: input.keepSourceOpen }) },
    });
    return { publicationId, result };
  }
}
