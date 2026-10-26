import * as React from 'react';
import type { CollaborationTask } from '@canvas-one/agents';
import { CollaborationPanel, type CollaborationIntent, type CollaborationMessage, type CollaborationProvider, type CollaborationReview } from './CollaborationPanel';
import type { AgentConversationController, ConversationMessage, ConversationProposal } from './conversation-controller';
import type { SessionController } from '../session/controller';
import { Button } from '../../components/ui/button';
import { ConnectionSetup } from './ConnectionSetup';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { renderDiagramSvg } from '../transfer/svg-export';
import { conversationErrorMessage } from './conversation-errors';
import { isDisplayableRecordChange, mergeProposalHistory } from './proposal-history';
import type { RecordKind } from '../../domain/studio/records';

const active = (task: CollaborationTask) => ['requested', 'working', 'waiting'].includes(task.status);
const providerName = (provider?: string) => provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : provider === 'agy' ? 'agy' : 'Agent';
export type ConversationComposerDraft = { readonly provider: CollaborationProvider; readonly intent: CollaborationIntent; readonly text: string; readonly permissionMode?: 'read' | 'write'; readonly writeBehavior?: 'suggest' | 'live' };

export function ConversationView({ controller, session, desktopRequired, onStartDraft, context = [], composerDraft, onComposerDraftChange, taskIds, onTaskStarted, externalMessages = [], onQueueMessage, queueBusy = false }: {
  readonly controller: AgentConversationController;
  readonly session: SessionController;
  readonly desktopRequired: boolean;
  readonly onStartDraft: () => void;
  readonly context?: readonly { readonly id: string; readonly label: string }[];
  readonly composerDraft: ConversationComposerDraft;
  readonly onComposerDraftChange: (patch: Partial<ConversationComposerDraft>) => void;
  readonly taskIds?: readonly string[];
  readonly onTaskStarted?: (id: string) => void | Promise<void>;
  readonly externalMessages?: readonly CollaborationMessage[];
  readonly onQueueMessage?: (text: string) => Promise<void>;
  readonly queueBusy?: boolean;
}) {
  const allState = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const state = React.useMemo(() => {
    if (!taskIds) return allState;
    const owns = (id?: string) => Boolean(id && taskIds.includes(id));
    return { ...allState, tasks: allState.tasks.filter(task => owns(task.id)), messages: allState.messages.filter(message => owns(message.taskId)), proposals: allState.proposals.filter(entry => owns(entry.taskId)), outstandingQuestions: allState.outstandingQuestions?.filter(message => owns(message.taskId)), activity: owns(allState.activity?.taskId) ? allState.activity : undefined, activityLog: allState.activityLog?.filter(activity => owns(activity.taskId)), blockedActions: allState.blockedActions.filter(action => owns(action.taskId)) };
  }, [allState, taskIds]);
  const board = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const { provider, intent, text } = composerDraft;
  const permissionMode = composerDraft.permissionMode ?? (intent === 'question' ? 'read' : 'write');
  const writeBehavior = composerDraft.writeBehavior ?? 'suggest';
  const read = permissionMode === 'read';
  const setProvider = (value: CollaborationProvider) => onComposerDraftChange({ provider: value });
  const setIntent = (value: CollaborationIntent) => onComposerDraftChange({ intent: value });
  const setText = (value: string) => onComposerDraftChange({ text: value });
  const [busy, setBusy] = React.useState(false);
  const inFlight = React.useRef(false);
  const [error, setError] = React.useState<string | undefined>();
  const [selectedTaskId, setSelectedTaskId] = React.useState<string>();
  const [selectedProposalId, setSelectedProposalId] = React.useState<string>();
  const [replyTargetId, setReplyTargetId] = React.useState<string>();
  const [archivedProposals, setArchivedProposals] = React.useState<{ taskId: string; proposals: readonly ConversationProposal[] }>();
  const [archivedContext, setArchivedContext] = React.useState<{ taskId: string; value: ConversationMessage['startingContext'] }>();
  const [grant, setGrant] = React.useState<{ taskId: string; attemptId: string; revision: number | null; context: NonNullable<ConversationMessage['startingContext']> } | null>(null);
  const restrictedIds = JSON.stringify(state.tasks.filter(task => task.kind !== 'question').map(task => task.id));
  React.useEffect(() => {
    if (read && restrictedIds !== '[]') void controller.restrictToRead(JSON.parse(restrictedIds) as string[]).catch(reason => setError(conversationErrorMessage(reason)));
  }, [controller, read, restrictedIds]);
  const changePermission = (mode: 'read' | 'write') => {
    if (inFlight.current) return;
    if (mode === 'read') {
      setGrant(null);
      // restrictToRead synchronously fences leases before its first await.
      void controller.restrictToRead(state.tasks.map(task => task.id)).catch(reason => setError(conversationErrorMessage(reason)));
    }
    onComposerDraftChange({ permissionMode: mode, intent: 'task' });
    setReplyTargetId(undefined);
  };
  const shownError = error ?? (state.error ? conversationErrorMessage(state.error) : undefined);
  const composerRef = React.useRef<HTMLDivElement>(null);
  const editing = [...state.tasks].reverse().find(task => task.kind !== 'question' && active(task));
  const editTasks = state.tasks;
  const task = editTasks.find(item => item.id === selectedTaskId) ?? editing ?? [...editTasks].reverse().find(item => item.status === 'interrupted' || item.status === 'failed') ?? editTasks.at(-1);
  const inViewContext = state.messages.find(message => message.role === 'user' && message.taskId === task?.id)?.startingContext;
  const startingContext = inViewContext ?? (archivedContext?.taskId === task?.id ? archivedContext?.value : undefined);
  React.useEffect(() => {
    if (!task || inViewContext) return;
    let cancelled = false;
    const scopeKey = JSON.stringify([board.projectId, board.branchId, board.document?.id]);
    void controller.loadStartingContext(task.id).then(value => {
      const current = session.getState();
      if (!cancelled && scopeKey === JSON.stringify([current.projectId, current.branchId, current.document?.id])) setArchivedContext({ taskId: task.id, value });
    }).catch(reason => { if (!cancelled) setError(conversationErrorMessage(reason)); });
    return () => { cancelled = true; };
  }, [controller, session, task?.id, inViewContext, board.projectId, board.branchId, board.document?.id]);
  React.useEffect(() => { setArchivedProposals(undefined); setArchivedContext(undefined); setSelectedTaskId(undefined); setSelectedProposalId(undefined); setReplyTargetId(undefined); setGrant(null); setError(undefined); }, [controller, board.projectId, board.branchId, board.document?.id]);
  const taskContext = startingContext ? `${startingContext.ids.length ? `${startingContext.ids.length} selected ${startingContext.ids.length === 1 ? 'item' : 'items'}` : 'Whole board'}${startingContext.omittedCount ? ` · ${startingContext.omittedCount} additional selections omitted` : ''}` : archivedContext?.taskId === task?.id ? 'Starting context not recorded' : 'Loading starting context…';
  const readOnlyHistory = selectedTaskId !== undefined;
  const liveTaskProposals = task ? state.proposals.filter(item => item.taskId === task.id) : state.proposals;
  const savedTaskProposals = readOnlyHistory && archivedProposals && archivedProposals.taskId === task?.id ? archivedProposals.proposals : liveTaskProposals;
  const ownedProposals = readOnlyHistory ? mergeProposalHistory(savedTaskProposals, liveTaskProposals) : liveTaskProposals;
  const candidate = ownedProposals.find(item => item.proposal.operationId === selectedProposalId) ?? [...ownedProposals].reverse().find(item => ['pending', 'accepting', 'conflict', 'invalid', 'failed'].includes(item.proposal.status)) ?? ownedProposals.at(-1);
  const proposal = candidate?.proposal;
  const unresolvedLiveReview = proposal && state.proposals.some(entry => entry.proposal.operationId === proposal.operationId && entry.proposal.scope.projectId === board.projectId && entry.proposal.scope.branchId === board.branchId && ['pending', 'conflict', 'invalid', 'failed'].includes(entry.proposal.status));
  const stale = Boolean(proposal && (proposal.scope.projectId !== board.projectId || proposal.scope.branchId !== board.branchId || proposal.expectedRevision !== board.workingRevision));
  const preview = React.useMemo(() => {
    if (read || !proposal || !board.document || stale) return undefined;
    const after = session.previewChanges(proposal.changes);
    if (!after.ok) return undefined;
    try {
      const viewId = board.document.views[0]?.id;
      return { before: renderDiagramSvg(board.document, viewId), after: renderDiagramSvg(after.document, viewId) };
    } catch { return undefined; }
  }, [proposal, board.document, board.workingRevision, session, stale, read]);
  const currentRecord = (kind: RecordKind, recordId: string) => {
    const document = board.document;
    if (!document || stale) return undefined;
    const tables = { element: document.elements, connection: document.connections, relation: document.relations, schema: document.schemas, fixture: document.fixtures, refinement: document.refinements, scenario: document.scenarios, view: document.views };
    return tables[kind].find(record => record.id === recordId);
  };
  const connected = state.connection === 'connected';
  const isMain = board.branchId === board.mainBranchId;
  const currentAttempt = task?.attempts.at(-1);
  const waitingQuestion = [...state.tasks].reverse().find(item => item.kind === 'question' && item.status === 'waiting' && item.waitReason === 'clarification');
  const replyTask = state.tasks.find(item => item.id === replyTargetId && item.status === 'waiting' && item.waitReason === 'clarification') ?? (task?.status === 'waiting' && task.waitReason === 'clarification' ? task : undefined);
  const clarification = Boolean(replyTask);
  const feedback = [...state.messages].reverse().find(message => message.role === 'user' && message.taskId === task?.id && message.delivery !== 'acknowledged');
  const revisingProposal = !readOnlyHistory && task?.status === 'waiting' && task.waitReason === 'review' && task.attempts.at(-1)?.status === 'finished' && proposal?.status === 'pending';
  const run = (action: () => Promise<unknown>, clearText = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(undefined); setBusy(true);
    return action().then(() => { if (clearText) setText(''); }).catch(reason => setError(conversationErrorMessage(reason))).finally(() => { inFlight.current = false; setBusy(false); });
  };
  const send = (messageText = text) => run(async () => {
    const instruction = messageText.trim();
    if (!read && (intent === 'feedback' || revisingProposal)) {
      if (readOnlyHistory) throw new Error('Historical proposals are read only. Return to current work to request changes.');
      if (!proposal) throw new Error('Choose a proposal before sending feedback.');
      await controller.requestChanges(proposal.operationId, instruction);
      setIntent('task');
    } else if (replyTask && (!read || replyTask.kind === 'question')) { await controller.send(replyTask.id, instruction, 'clarification'); setReplyTargetId(undefined); }
    else if (!read && !isMain && allState.tasks.some(item => item.kind !== 'question' && active(item)) && onQueueMessage) {
      await onQueueMessage(instruction);
    } else {
      await controller.start(provider, instruction, read || isMain ? 'question' : 'edit', onTaskStarted, { ids: context.map(item => item.id).filter(id => id !== 'whole-board') });
      setSelectedTaskId(undefined);
    }
  }, true);
  const review: CollaborationReview | undefined = !read && proposal ? {
    id: proposal.operationId, title: proposal.label,
    status: proposal.status === 'accepted' || proposal.status === 'rejected' ? proposal.status : stale || proposal.status === 'conflict' ? 'stale' : proposal.status === 'pending' || proposal.status === 'accepting' ? 'ready' : 'invalid',
    busy: busy || proposal.status === 'accepting', issue: proposal.issues.map(issue => issue.message).join('; ') || undefined,
    changes: proposal.changes.map((change, index) => {
      if (!isDisplayableRecordChange(change)) return { id: `${index}`, kind: 'change', label: 'Invalid proposed change', detail: 'This change has an unsupported or incomplete record format. Review the validation errors and request revised changes.' };
      const record = change.kind === 'remove' ? currentRecord(change.recordKind, change.id) : change.value.record;
      const label = record && 'label' in record && typeof record.label === 'string' ? record.label : record && 'name' in record && typeof record.name === 'string' ? record.name : change.kind === 'remove' ? `${change.recordKind} ${change.id}` : `${change.value.recordKind} ${record?.id}`;
      let detail = change.kind === 'remove' ? 'Removed in the after-state; inspect the before-state below.' : change.kind === 'insert' ? `New ${change.value.recordKind}.` : `Updated ${change.value.recordKind}.`;
      if (change.kind === 'replace') {
        const before = currentRecord(change.value.recordKind, change.value.record.id) as unknown as Record<string, unknown> | undefined;
        const after = change.value.record as unknown as Record<string, unknown>;
        if (before) {
          const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => key !== 'id' && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
          detail = fields.map(key => {
            const name = key.replace(/([a-z])([A-Z])/g, '$1 $2');
            const scalar = (value: unknown) => value === undefined ? 'unset' : value === null ? 'none' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
            const oldValue = scalar(before[key]), newValue = scalar(after[key]);
            return oldValue !== undefined && newValue !== undefined ? `${name}: ${oldValue} → ${newValue}` : `${name} updated`;
          }).join('; ') || detail;
        }
      }
      return { id: `${index}`, kind: change.kind === 'remove' ? 'remove' : change.kind === 'insert' ? 'add' : 'change', label, detail };
    }),
    comparison: preview ? <details className="text-caption"><summary className="cursor-pointer">Compare before and after</summary><div className="space-y-3 pt-2">{(['before', 'after'] as const).map(version => <figure key={version}><figcaption>{version === 'before' ? 'Current board · before changes' : 'Detached proposal · after changes'}</figcaption><img alt={version === 'before' ? 'Board before proposed changes, including content proposed for removal' : 'Detached proposed board after changes'} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview[version])}`} className="max-h-64 w-full border border-hairline" /></figure>)}</div></details> : stale ? <p className="text-caption text-secondary-text">The board changed. Request revised changes before accepting.</p> : undefined,
    onAccept: unresolvedLiveReview && !desktopRequired && proposal.status === 'pending' && !stale ? () => run(() => controller.accept(proposal.operationId)) : undefined,
    rejectLabel: readOnlyHistory ? 'Dismiss pending review' : undefined,
    onReject: unresolvedLiveReview && !desktopRequired && ['pending', 'conflict', 'invalid', 'failed'].includes(proposal.status) ? () => run(async () => {
      await controller.reject(proposal.operationId);
      if (readOnlyHistory && task) {
        const proposals = await controller.openTaskHistory(task.id);
        const current = session.getState();
        if (current.projectId === board.projectId && current.branchId === board.branchId && current.document?.id === board.document?.id) setArchivedProposals({ taskId: task.id, proposals });
      }
    }) : undefined,
    onRequestChanges: !readOnlyHistory && !desktopRequired && ['pending', 'conflict'].includes(proposal.status) ? () => { setIntent('feedback'); setSelectedProposalId(proposal.operationId); requestAnimationFrame(() => composerRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()); } : undefined,
  } : undefined;
  const boardWriter = allState.tasks.find(item => item.kind !== 'question' && active(item));
  const disabledReason = desktopRequired ? 'Start and control AI requests from your desktop.' : busy || queueBusy ? 'Waiting for this action to finish.' : !read && intent === 'feedback' && readOnlyHistory ? 'Return to current work to request revised changes.' : !read && !isMain && boardWriter && !clarification && !revisingProposal && intent !== 'feedback' && !onQueueMessage ? 'An editing request is active. Wait for its review or stop it before sending another. Read remains available.' : undefined;
  return <div ref={composerRef} className="h-full min-h-0">
    <CollaborationPanel provider={provider} providers={(['claude', 'codex', 'agy'] as const).map(providerId => { const availability = state.providers.find(item => item.id === providerId); return { id: providerId, label: providerName(providerId), ...(connected && availability && !availability.available ? { unavailableReason: availability.detail } : {}) }; })} onProviderChange={setProvider}
      connection={{ status: desktopRequired ? 'desktop-required' : state.connection === 'pairing' ? 'connecting' : state.connection, detail: shownError, setup: !desktopRequired ? <ConnectionSetup connecting={state.connection === 'pairing'} error={shownError} onConnect={async (url, secret) => { setError(undefined); await controller.pair(url, secret); }} /> : undefined, onDisconnect: !desktopRequired && connected ? () => { void controller.disconnect().catch(reason => setError(conversationErrorMessage(reason))); } : undefined }}
      task={task && { id: task.id, attemptId: currentAttempt?.id, title: `${providerName(task.providerId)} · ${task.instruction}`, status: task.status === 'waiting' ? `Waiting · ${task.waitReason}` : task.status, permission: task.permission, liveScopeLabel: startingContext?.ids.length ? 'Captured objects and dependent connections, including deletions' : 'Whole board, including deletions', context: taskContext, activity: state.blockedActions.some(action => action.taskId === task.id) ? 'An affected action needs a decision. Your edits remain.' : undefined, expression: task.status === 'working' ? 'squint' : task.status === 'completed' ? 'happy' : task.status === 'failed' ? 'error' : task.status === 'waiting' || task.status === 'interrupted' ? 'wait' : 'base', interruptedSummary: task.status === 'interrupted' ? `Previous permission: ${task.interruptedPermission ?? 'suggest'}. Completed changes remain; pending proposals can be inspected. Resume checks the current board before starting another attempt.` : undefined, cancellation: task.cancellation === 'pending' ? 'Further board writes are disabled. Agent cancellation has not been acknowledged.' : task.cancellation === 'acknowledged' ? 'Agent cancellation acknowledged.' : undefined,
        stopLabel: !active(task) ? 'Retry Stop' : undefined,
        onStop: !desktopRequired && connected && (active(task) || task.attempts.some(attempt => attempt.cancellation === 'pending')) ? () => { setError(undefined); if (controller.getState().tasks.find(item => item.id === task.id)?.attempts.at(-1)?.id !== currentAttempt?.id) { setError('This attempt has ended. Use the current attempt’s Stop control.'); return; } void (active(task) ? controller.stop(task.id, currentAttempt?.id) : controller.retryStop(task.id)).catch(reason => setError(conversationErrorMessage(reason))); } : undefined,
        onResume: !desktopRequired && connected && (!read || task.kind === 'question') && (task.status === 'interrupted' || task.status === 'failed') ? () => run(() => controller.resume(task.id)) : undefined,
        onUndo: !read && !desktopRequired && (state.undoableTaskIds?.includes(task.id) || state.pendingUndoTaskIds?.includes(task.id)) ? () => run(async () => { const operationId = await controller.undo(task.id); const current = session.getState(); if (operationId && current.projectId === board.projectId && current.branchId === board.branchId && current.document?.id === board.document?.id) setSelectedProposalId(operationId); }) : undefined,
        onSkipHeldAction: !desktopRequired && state.blockedActions.some(action => action.taskId === task.id) && (connected && task.status === 'waiting' && task.waitReason === 'overlap' || ['interrupted', 'stopped', 'failed'].includes(task.status)) ? () => run(() => controller.resolveOverlap(task.id)) : undefined,
        onRequestLivePermission: !read && !desktopRequired && connected && active(task) && task.kind !== 'question' && currentAttempt?.status === 'working' && startingContext ? (taskId, attemptId) => setGrant({ taskId, attemptId, revision: board.workingRevision, context: startingContext }) : undefined,
      }}
      activity={(state.activity && state.tasks.some(item => item.id === state.activity?.taskId && active(item)) ? state.activity.label : undefined) ?? (editing?.status === 'requested' ? 'Starting agent…' : editing?.status === 'working' ? 'Working…' : editing?.status === 'waiting' && editing.waitReason === 'review' ? 'Changes ready for review.' : state.tasks.some(item => item.kind === 'question' && active(item)) ? 'Answering your question…' : undefined)}
      activityLog={state.activityLog}
      responseControls={state.tasks.filter(item => item.kind === 'question' && active(item)).map(item => ({ id: item.id, label: `${providerName(item.providerId)} · ${item.instruction}`, onStop: () => { void controller.stop(item.id, item.attempts.at(-1)?.id).catch(reason => setError(conversationErrorMessage(reason))); } }))}
      messages={[...externalMessages, ...state.messages.map(message => ({ id: message.id, taskId: message.taskId, attemptId: message.attemptId, important: message.role === 'system' && message.classification !== 'diagnostic', author: message.role === 'user' ? 'You' : message.role === 'system' ? 'Notice' : providerName(state.tasks.find(item => item.id === message.taskId)?.providerId), kind: message.role === 'user' ? 'user' as const : message.role === 'system' ? 'activity' as const : 'agent' as const, text: message.text }))]}
      awaitingAnswers={state.outstandingQuestions?.filter(question => !state.messages.some(message => message.id === question.id) && (!read || state.tasks.find(task => task.id === question.taskId)?.kind === 'question')).map(question => ({ id: question.id, author: providerName(state.tasks.find(item => item.id === question.taskId)?.providerId), text: question.text, onReply: !desktopRequired && connected && question.taskId ? () => { setReplyTargetId(question.taskId); setIntent('task'); requestAnimationFrame(() => composerRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()); } : undefined }))}
      review={review} feedbackDelivery={feedback && { status: feedback.delivery === 'queued' ? 'sending' : feedback.delivery, detail: feedback.delivery === 'delivered' ? 'Message delivered; agent acknowledgement has not arrived.' : feedback.delivery === 'queued' ? 'Sending message…' : feedback.delivery === 'failed' ? 'Message delivery failed. Your instruction is saved in the conversation.' : 'Message acknowledged.' }}
      composer={{ intent, text, permissionMode, writeBehavior, onPermissionModeChange: changePermission, onWriteBehaviorChange: value => { if (value === 'suggest' && task?.permission === 'live' && active(task)) void run(() => controller.stop(task.id, currentAttempt?.id)); onComposerDraftChange({ writeBehavior: value }); }, inputLabel: 'Message', targetLabel: !read && intent === 'feedback' ? `Revising ${proposal?.label ?? 'proposed changes'}` : replyTask ? `Reply to ${providerName(replyTask.providerId)}` : undefined, context: context.length ? context : [{ id: 'whole-board', label: 'Whole current board' }], onTextChange: setText, onIntentChange: value => { setIntent(value); if (value !== 'task') setReplyTargetId(undefined); }, onSend: !desktopRequired && connected ? send : undefined, onReplyClarification: !desktopRequired && connected && waitingQuestion && replyTargetId !== waitingQuestion.id ? () => { setReplyTargetId(waitingQuestion.id); setIntent('task'); } : undefined, onCreateDraft: !read && !desktopRequired && isMain && !clarification ? onStartDraft : undefined, permissionDetail: read ? 'Read can inspect and explain. It cannot propose or apply changes.' : isMain ? 'Questions are available here. Create a draft to propose or apply changes.' : writeBehavior === 'live' ? 'Live still requires your permission for each request. Questions can be answered normally.' : 'Questions and change requests belong here. Changes wait for approval.', disabledReason, sending: busy, error: shownError }}
      onLoadEarlierMessages={state.hasEarlierMessages && !busy ? () => run(() => controller.loadEarlierMessages()) : undefined}
      historyWindowGap={state.historyWindowGap}
      onReturnToRecentMessages={state.historyWindowGap ? () => controller.returnToRecentMessages() : undefined}
      historyContent={readOnlyHistory && <section className="mb-3 space-y-2 text-caption" aria-label="Task proposal history"><p>All pending reviews and latest 100 saved proposals. Saved outcomes are read only; pending reviews can be dismissed.</p>{archivedProposals && archivedProposals.taskId === task?.id && archivedProposals.proposals.length === 0 && <p>No saved proposals for this task.</p>}<ul>{ownedProposals.map(entry => <li key={entry.proposal.operationId}><Button type="button" variant="link" size="sm" className="max-w-full justify-start text-left" onClick={() => setSelectedProposalId(entry.proposal.operationId)}>{entry.proposal.label} · {entry.proposal.status}</Button></li>)}</ul><Button type="button" variant="outline" size="sm" onClick={() => { setSelectedTaskId(undefined); setSelectedProposalId(undefined); }}>{editing ? 'Return to active task' : 'Return to latest task'}</Button></section>}
      history={editTasks.filter(item => item.id !== task?.id).map(item => ({ id: item.id, title: `${providerName(item.providerId)} · ${item.instruction}`, outcome: `${item.status} · ${item.permission}`, onOpen: () => { setSelectedTaskId(item.id); setSelectedProposalId(undefined); const scopeKey = JSON.stringify([board.projectId, board.branchId, board.document?.id]); run(async () => { const proposals = await controller.openTaskHistory(item.id); const current = session.getState(); if (scopeKey === JSON.stringify([current.projectId, current.branchId, current.document?.id])) setArchivedProposals({ taskId: item.id, proposals }); }); } }))}
    />
    <Dialog open={Boolean(grant) && !read} onOpenChange={open => { if (!open) setGrant(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{isMain ? 'Live editing needs a draft' : 'Allow Live for this request?'}</DialogTitle><DialogDescription>{isMain ? 'Create or switch to a draft, then send a request there. Permission stays on the board where it was granted.' : grant?.context.ids.length ? 'Allow this exact request to update or delete its captured objects and dependent connections. New objects or expanded scope need a new request. Stop keeps completed changes. Every later request needs fresh permission.' : 'Allow this exact request to create, change and delete content across the current board. Stop keeps completed changes. Every later request needs fresh permission.'}</DialogDescription></DialogHeader>
      <p className="break-words text-caption">{providerName(state.tasks.find(item => item.id === grant?.taskId)?.providerId)} · {state.tasks.find(item => item.id === grant?.taskId)?.instruction ?? 'This task is no longer available.'}</p>
      <p className="text-caption text-secondary-text">Board revision {grant?.revision} · {grant?.context.ids.length ? `Update and delete · ${grant.context.ids.join(', ')} · Captured dependent connections` : 'Create, update and delete · Whole board'}</p>
      {isMain ? <Button type="button" onClick={() => { setGrant(null); onStartDraft(); }}>Create a draft</Button> : <Button type="button" disabled={busy} onClick={() => { const binding = grant; if (!binding) return; run(async () => { const current = controller.getState().tasks.find(item => item.id === binding.taskId); if (!current || current.attempts.at(-1)?.id !== binding.attemptId || !active(current)) throw new Error('This execution attempt is no longer active.'); if (session.getState().workingRevision !== binding.revision) throw new Error('The board changed while permission was open. Close this dialog and review Live permission again.'); await controller.grantLive(binding.taskId, binding.attemptId); onComposerDraftChange({ writeBehavior: 'live' }); setGrant(null); }); }}>Allow Live for this request</Button>}
      <Button type="button" variant="outline" onClick={() => setGrant(null)}>Keep Suggest</Button>
      {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
    </DialogContent></Dialog>
  </div>;
}
