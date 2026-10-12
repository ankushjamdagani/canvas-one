import { createIssue, type ValidationIssue } from '@canvas-one/whiteboard';
import type { CandidateState } from './candidates.js';
import { mintPublishTicket, type PublishTicket } from './publish-ticket.js';
import type { HistoryPublishCommand } from './publishing.js';

type PublicationIssue<Code extends string> = ValidationIssue<Code | 'wrong-type' | 'missing-property' | 'structural-rule'>;
export type CandidatePublishResult<Result, Code extends string> = Result
  | { readonly status: 'missing'; readonly ids: readonly string[] }
  | { readonly status: 'invalid'; readonly issues: readonly PublicationIssue<Code>[] }
  | { readonly status: 'failed'; readonly code: 'ineligible' | 'conflict'; readonly issues: readonly PublicationIssue<Code>[] };
export type CandidatePublicationPorts<Merge, Document, Actor, Evidence, Code extends string, Result> = {
  readonly getCandidate: (id: string) => CandidateState<Merge> | null;
  readonly conflictIds: (merge: Merge) => readonly string[];
  readonly issues: (merge: Merge) => readonly ValidationIssue<Code>[];
  readonly document: (merge: Merge) => Document;
  readonly validateUuid: (value: unknown, path: readonly (string | number)[], name: string) => ValidationIssue<Code> | null;
  readonly validateRevision: (value: unknown, path: readonly (string | number)[], name: string) => ValidationIssue<Code> | null;
  readonly validateActor: (actor: unknown) => readonly ValidationIssue<Code>[] | null;
  readonly publish: (ticket: PublishTicket<Document>, command: HistoryPublishCommand<Actor, Evidence>) => Promise<Result>;
};

/** Validates publication scope and issues an authority ticket only for a ready, live candidate. */
export async function publishCandidate<Merge, Document, Actor, Evidence, Code extends string, Result>(
  ports: CandidatePublicationPorts<Merge, Document, Actor, Evidence, Code, Result>,
  command: HistoryPublishCommand<Actor, Evidence>,
): Promise<CandidatePublishResult<Result, Code>> {
    if (!command || typeof command !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('wrong-type', 'command must be an object', [])],
      };
    }

    // Envelope field validation. No fallbacks: every field must be present and valid.
    const opIdIssue = ports.validateUuid(command.operationId, ['operationId'], 'operationId');
    if (opIdIssue) {
      return { status: 'invalid', issues: [opIdIssue] };
    }

    const projectIdIssue = ports.validateUuid(command.projectId, ['projectId'], 'projectId');
    if (projectIdIssue) {
      return { status: 'invalid', issues: [projectIdIssue] };
    }

    const branchIdIssue = ports.validateUuid(command.branchId, ['branchId'], 'branchId');
    if (branchIdIssue) {
      return { status: 'invalid', issues: [branchIdIssue] };
    }

    const workingRevIssue = ports.validateRevision(
      command.expectedWorkingRevision,
      ['expectedWorkingRevision'],
      'expectedWorkingRevision',
    );
    if (workingRevIssue) {
      return { status: 'invalid', issues: [workingRevIssue] };
    }

    const actorIssues = ports.validateActor(command.actor);
    if (actorIssues) {
      return { status: 'invalid', issues: actorIssues };
    }

    if (!command.payload || typeof command.payload !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'payload is required', ['payload'])],
      };
    }

    const payload = command.payload;

    const candidateIdIssue = ports.validateUuid(
      payload.candidateId,
      ['payload', 'candidateId'],
      'candidateId',
    );
    if (candidateIdIssue) {
      return { status: 'invalid', issues: [candidateIdIssue] };
    }

    const publicationIdIssue = ports.validateUuid(
      payload.publicationId,
      ['payload', 'publicationId'],
      'publicationId',
    );
    if (publicationIdIssue) {
      return { status: 'invalid', issues: [publicationIdIssue] };
    }

    const mergeCommitIdIssue = ports.validateUuid(
      payload.mergeCommitId,
      ['payload', 'mergeCommitId'],
      'mergeCommitId',
    );
    if (mergeCommitIdIssue) {
      return { status: 'invalid', issues: [mergeCommitIdIssue] };
    }

    if (!payload.metadata || typeof payload.metadata !== 'object') {
      return {
        status: 'invalid',
        issues: [
          createIssue('missing-property', 'payload.metadata is required', ['payload', 'metadata']),
        ],
      };
    }

    if (!Array.isArray(payload.evidence)) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'missing-property',
            'payload.evidence is required and must be an array',
            ['payload', 'evidence'],
          ),
        ],
      };
    }

    // keepSourceOpen is the only defaulted field (omitted -> false).
    let keepSourceOpen: boolean;
    if (payload.keepSourceOpen === undefined) {
      keepSourceOpen = false;
    } else if (typeof payload.keepSourceOpen !== 'boolean') {
      return {
        status: 'invalid',
        issues: [
          createIssue('wrong-type', 'payload.keepSourceOpen must be a boolean', [
            'payload',
            'keepSourceOpen',
          ]),
        ],
      };
    } else {
      keepSourceOpen = payload.keepSourceOpen;
    }

    const expectedProjectRevIssue = ports.validateRevision(
      payload.expectedProjectRevision,
      ['payload', 'expectedProjectRevision'],
      'expectedProjectRevision',
    );
    if (expectedProjectRevIssue) {
      return { status: 'invalid', issues: [expectedProjectRevIssue] };
    }

    const candidateId = payload.candidateId;
    const cand = ports.getCandidate(candidateId);
    if (!cand) {
      return { status: 'missing', ids: [candidateId] };
    }

    if (cand.superseded) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${candidateId}' is superseded`,
            ['candidateId'],
            candidateId,
          ),
        ],
      };
    }

    if (ports.conflictIds(cand.mergeState).length > 0) {
      return {
        status: 'failed',
        code: 'conflict',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${candidateId}' has ${ports.conflictIds(cand.mergeState).length} unresolved conflicts`,
            ['conflicts'],
          ),
        ],
      };
    }

    if (ports.issues(cand.mergeState).length > 0) {
      return {
        status: 'invalid',
        issues: ports.issues(cand.mergeState),
      };
    }

    // Context mismatch is rejected outright; it is never a fallback to the candidate's values.
    if (command.projectId !== cand.projectId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Command projectId '${command.projectId}' does not match candidate projectId '${cand.projectId}'`,
            ['projectId'],
            command.projectId,
          ),
        ],
      };
    }

    if (command.branchId !== cand.sourceBranchId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Command branchId '${command.branchId}' does not match candidate sourceBranchId '${cand.sourceBranchId}'`,
            ['branchId'],
            command.branchId,
          ),
        ],
      };
    }

    if (command.expectedWorkingRevision !== cand.expectedSourceRevision) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Command expectedWorkingRevision '${command.expectedWorkingRevision}' does not match candidate expectedSourceRevision '${cand.expectedSourceRevision}'`,
            ['expectedWorkingRevision'],
          ),
        ],
      };
    }

    const ticket = mintPublishTicket({
      candidateId: cand.candidateId,
      projectId: cand.projectId,
      sourceBranchId: cand.sourceBranchId,
      mainBranchId: cand.mainBranchId,
      expectedSourceRevision: cand.expectedSourceRevision,
      expectedSourceHeadId: cand.expectedSourceHeadId,
      expectedMainRevision: cand.expectedMainRevision,
      expectedMainHeadId: cand.expectedMainHeadId,
      snapshotId: cand.snapshotId,
      document: ports.document(cand.mergeState),
      operationId: command.operationId,
    });

    const fullCommand: HistoryPublishCommand<Actor, Evidence> = {
      commandId: 'history.publish',
      operationId: command.operationId,
      projectId: command.projectId,
      branchId: command.branchId,
      expectedWorkingRevision: command.expectedWorkingRevision,
      actor: command.actor,
      payload: {
        candidateId: payload.candidateId,
        publicationId: payload.publicationId,
        mergeCommitId: payload.mergeCommitId,
        metadata: payload.metadata,
        evidence: payload.evidence,
        keepSourceOpen,
        expectedProjectRevision: payload.expectedProjectRevision,
      },
    };

    return ports.publish(ticket, fullCommand);
  }
