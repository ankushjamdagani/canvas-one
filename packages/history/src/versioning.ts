import { createIssue, type ValidationIssue } from '@canvas-one/whiteboard';

export type VersioningIssue = ValidationIssue<'structural-rule' | 'too-long' | 'missing-property'>;
export type VersioningScope = {
  readonly projectId: string; readonly branchId: string; readonly workingRevision: number; readonly isMain: boolean;
};
export type HistoryCommandEnvelope<Actor> = {
  readonly operationId: string; readonly projectId: string; readonly branchId: string;
  readonly expectedWorkingRevision: number; readonly actor: Actor;
};
export type HistoryCheckpointCommand<Actor> = HistoryCommandEnvelope<Actor> & {
  readonly commandId: 'history.checkpoint'; readonly payload: { readonly checkpointId: string; readonly label: string };
};
export type HistoryRestoreCommand<Actor> = HistoryCommandEnvelope<Actor> & {
  readonly commandId: 'history.restore'; readonly payload: { readonly snapshotId: string; readonly checkpointId: string; readonly label: string };
};
export type HistoryCommitCommand<Actor, Evidence> = HistoryCommandEnvelope<Actor> & {
  readonly commandId: 'history.commit'; readonly payload: {
    readonly commitId: string; readonly expectedHeadId: string | null; readonly message: string; readonly evidence: readonly Evidence[];
  };
};
export type HistoryAuthoredCommand<Actor, Evidence> = HistoryCheckpointCommand<Actor> | HistoryRestoreCommand<Actor> | HistoryCommitCommand<Actor, Evidence>;
export type VersioningPorts<Actor, Evidence, Result extends { readonly status: string }> = {
  readonly getScope: () => VersioningScope | null;
  readonly actor: Actor;
  readonly mintId: () => string;
  readonly execute: (command: HistoryAuthoredCommand<Actor, Evidence>) => Promise<Result>;
  /** Called after a successful receipt. Restore/commit hosts reload their authoritative session and reset local undo. */
  readonly afterApplied: (scope: VersioningScope, kind: HistoryAuthoredCommand<Actor, Evidence>['commandId']) => Promise<void>;
  readonly invalid: (issues: readonly VersioningIssue[]) => Result;
  readonly mapError: (error: unknown) => Result;
};

/** Branch-local version operations. Semantic evidence and publication eligibility belong to injected domain policies. */
export class VersioningService<Actor, Evidence, Result extends { readonly status: string }> {
  constructor(private readonly ports: VersioningPorts<Actor, Evidence, Result>) {}

  async checkpoint(label: string): Promise<Result> {
    if (typeof label !== 'string') throw new TypeError('saveCheckpoint requires a string label');
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > 80) return this.ports.invalid([
      createIssue('too-long', 'Checkpoint label must be between 1 and 80 code points', ['payload', 'label']),
    ]);
    const scope = this.ports.getScope();
    if (!scope) return this.noScope();
    const checkpointId = this.ports.mintId();
    return this.execute(scope, { commandId: 'history.checkpoint', ...this.envelope(scope), payload: { checkpointId, label: trimmed } });
  }

  async restore(snapshotId: string, label: string): Promise<Result> {
    if (typeof label !== 'string') throw new TypeError('restore requires a string label for the pre-restore checkpoint');
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > 80) return this.ports.invalid([
      createIssue('too-long', 'Pre-restore checkpoint label must be between 1 and 80 code points', ['payload', 'label']),
    ]);
    const scope = this.ports.getScope();
    if (!scope) return this.noScope();
    if (scope.isMain) return this.ports.invalid([
      createIssue('structural-rule', 'Direct restore on main branch is rejected; main is changed only by publication', ['branchId']),
    ]);
    const checkpointId = this.ports.mintId();
    return this.execute(scope, { commandId: 'history.restore', ...this.envelope(scope), payload: { snapshotId, checkpointId, label: trimmed } });
  }

  async commit(input: {
    readonly message: string; readonly expectedHeadId: string | null;
    readonly expectedWorkingRevision?: number; readonly evidence: readonly Evidence[];
    readonly scope?: VersioningScope;
  }): Promise<Result> {
    const scope = input.scope ?? this.ports.getScope();
    if (!scope) return this.noScope();
    if (scope.isMain) return this.ports.invalid([
      createIssue('structural-rule', 'Direct commit on main branch is rejected; main never holds edits', ['branchId']),
    ]);
    if (typeof input.message !== 'string') throw new TypeError('commit requires a string message');
    const message = input.message.trim();
    if (message.length < 1 || message.length > 4000) return this.ports.invalid([
      createIssue('missing-property', 'Commit message is required and must be between 1 and 4000 code points', ['message']),
    ]);
    return this.execute(scope, {
      commandId: 'history.commit', ...this.envelope(scope),
      expectedWorkingRevision: input.expectedWorkingRevision ?? scope.workingRevision,
      payload: { commitId: this.ports.mintId(), expectedHeadId: input.expectedHeadId, message, evidence: input.evidence },
    });
  }

  private envelope(scope: VersioningScope): HistoryCommandEnvelope<Actor> {
    return { operationId: this.ports.mintId(), projectId: scope.projectId, branchId: scope.branchId,
      expectedWorkingRevision: scope.workingRevision, actor: this.ports.actor };
  }
  private noScope(): Result { return this.ports.invalid([createIssue('structural-rule', 'No project is open in session', [])]); }
  private async execute(scope: VersioningScope, command: HistoryAuthoredCommand<Actor, Evidence>): Promise<Result> {
    try {
      const result = await this.ports.execute(command);
      if (result.status === 'applied') await this.ports.afterApplied(scope, command.commandId);
      return result;
    } catch (error) { return this.ports.mapError(error); }
  }
}
