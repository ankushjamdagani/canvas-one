import * as React from 'react';
import type { CollaborationTask } from '@canvas-one/agents';
import { CollaborationPanel, type CollaborationIntent, type CollaborationProvider, type CollaborationReview } from './CollaborationPanel';
import type { AgentConversationController, ConversationMessage, ConversationProposal } from './conversation-controller';
import type { SessionController } from '../session/controller';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { renderDiagramSvg } from '../transfer/svg-export';
import { conversationErrorMessage } from './conversation-errors';
import { mergeProposalHistory } from './proposal-history';
import type { RecordKind } from '../../domain/studio/records';

const active = (task: CollaborationTask) => ['requested', 'working', 'waiting'].includes(task.status);
const providerName = (provider?: string) => provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : provider === 'agy' ? 'agy' : 'Agent';
export type ConversationComposerDraft = { readonly provider: CollaborationProvider; readonly intent: CollaborationIntent; readonly text: string };

export function ConversationView({ controller, session, desktopRequired, onStartDraft, context = [], composerDraft, onComposerDraftChange }: {
  readonly controller: AgentConversationController;
  readonly session: SessionController;
  readonly desktopRequired: boolean;
  readonly onStartDraft: () => void;
  readonly context?: readonly { readonly id: string; readonly label: string }[];
  readonly composerDraft: ConversationComposerDraft;
  readonly onComposerDraftChange: (patch: Partial<ConversationComposerDraft>) => void;
}) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const board = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const { provider, intent, text } = composerDraft;
  const setProvider = (value: CollaborationProvider) => onComposerDraftChange({ provider: value });
  const setIntent = (value: CollaborationIntent) => onComposerDraftChange({ intent: value });
  const setText = (value: string) => onComposerDraftChange({ text: value });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [url, setUrl] = React.useState('http://127.0.0.1:47831');
  const [secret, setSecret] = React.useState('');
  const [selectedTaskId, setSelectedTaskId] = React.useState<string>();
  const [selectedProposalId, setSelectedProposalId] = React.useState<string>();
  const [replyTargetId, setReplyTargetId] = React.useState<string>();
  const [archivedProposals, setArchivedProposals] = React.useState<{ taskId: string; proposals: readonly ConversationProposal[] }>();
  const [archivedContext, setArchivedContext] = React.useState<{ taskId: string; value: ConversationMessage['startingContext'] }>();
  const [grant, setGrant] = React.useState<{ taskId: string; attemptId: string } | null>(null);
  const shownError = error ?? (state.error ? conversationErrorMessage(state.error) : undefined);
  const composerRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const editing = [...state.tasks].reverse().find(task => task.kind !== 'question' && active(task));
  const editTasks = state.tasks.filter(item => item.kind !== 'question');
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
    if (!proposal || !board.document || stale) return undefined;
    const after = session.previewChanges(proposal.changes);
    if (!after.ok) return undefined;
    try {
      const viewId = board.document.views[0]?.id;
      return { before: renderDiagramSvg(board.document, viewId), after: renderDiagramSvg(after.document, viewId) };
    } catch { return undefined; }
  }, [proposal, board.document, board.workingRevision, session, stale]);
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
  const run = (action: () => Promise<unknown>, clearText = false) => {
    if (busy) return;
    setError(undefined); setBusy(true);
    void action().then(() => { if (clearText) setText(''); }).catch(reason => setError(conversationErrorMessage(reason))).finally(() => setBusy(false));
  };
  const send = () => run(async () => {
    const instruction = text.trim();
    if (intent === 'feedback') {
      if (readOnlyHistory) throw new Error('Historical proposals are read only. Return to current work to request changes.');
      if (!proposal) throw new Error('Choose a proposal before sending feedback.');
      await controller.requestChanges(proposal.operationId, instruction);
    } else if (intent === 'task' && replyTask) { await controller.send(replyTask.id, instruction, 'clarification'); setReplyTargetId(undefined); }
    else if (intent === 'question') await controller.start(provider, instruction, 'question');
    else { await controller.start(provider, instruction, 'edit'); setSelectedTaskId(undefined); }
  }, true);
  const review: CollaborationReview | undefined = proposal && {
    id: proposal.operationId, title: proposal.label,
    status: proposal.status === 'accepted' || proposal.status === 'rejected' ? proposal.status : stale || proposal.status === 'conflict' ? 'stale' : proposal.status === 'pending' || proposal.status === 'accepting' ? 'ready' : 'invalid',
    busy: busy || proposal.status === 'accepting', issue: proposal.issues.map(issue => issue.message).join('; ') || undefined,
    changes: proposal.changes.map((change, index) => {
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
  };
  const disabledReason = desktopRequired ? 'Start and control agent tasks from your desktop.' : busy ? 'Waiting for this action to finish.' : intent === 'feedback' && readOnlyHistory ? 'Historical proposals are read only. Return to current work to request changes.' : intent === 'task' && isMain && !clarification ? 'Create or switch to a draft before starting editing work. Questions are available here.' : intent === 'task' && editing && !clarification ? 'One editing task is active. Ask a question, provide proposal feedback, or stop it before starting another.' : undefined;
  const origin = typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin;
  return <div ref={composerRef} className="h-full min-h-0">
    <CollaborationPanel provider={provider} providers={(['claude', 'codex', 'agy'] as const).map(providerId => { const availability = state.providers.find(item => item.id === providerId); return { id: providerId, label: providerName(providerId), ...(connected && availability && !availability.available ? { unavailableReason: availability.detail } : {}) }; })} onProviderChange={setProvider}
      connection={{ status: desktopRequired ? 'desktop-required' : state.connection === 'pairing' ? 'connecting' : state.connection, detail: shownError, onSetup: !desktopRequired ? () => setSetupOpen(true) : undefined, onDisconnect: !desktopRequired && connected ? () => { void controller.disconnect().catch(reason => setError(conversationErrorMessage(reason))); } : undefined }}
      task={task && { id: task.id, attemptId: currentAttempt?.id, title: `${providerName(task.providerId)} · ${task.instruction}`, status: task.status === 'waiting' ? `Waiting · ${task.waitReason}` : task.status, permission: task.permission, context: taskContext, activity: state.blockedActions.some(action => action.taskId === task.id) ? 'An affected action needs a decision. Your edits remain.' : undefined, expression: task.status === 'working' ? 'squint' : task.status === 'completed' ? 'happy' : task.status === 'failed' ? 'error' : task.status === 'waiting' || task.status === 'interrupted' ? 'wait' : 'base', interruptedSummary: task.status === 'interrupted' ? `Previous permission: ${task.interruptedPermission ?? 'suggest'}. Completed changes remain; pending proposals can be inspected. Resume checks the current board before starting another attempt.` : undefined, cancellation: task.cancellation === 'pending' ? 'Further board writes are disabled. Agent cancellation has not been acknowledged.' : task.cancellation === 'acknowledged' ? 'Agent cancellation acknowledged.' : undefined,
        stopLabel: !active(task) ? 'Retry Stop' : undefined,
        onStop: !desktopRequired && connected && (active(task) || task.attempts.some(attempt => attempt.cancellation === 'pending')) ? () => { setError(undefined); void (active(task) ? controller.stop(task.id) : controller.retryStop(task.id)).catch(reason => setError(conversationErrorMessage(reason))); } : undefined,
        onResume: !desktopRequired && connected && (task.status === 'interrupted' || task.status === 'failed') ? () => run(() => controller.resume(task.id)) : undefined,
        onUndo: !desktopRequired && ['completed', 'stopped', 'failed', 'interrupted'].includes(task.status) ? () => run(async () => { const operationId = await controller.undo(task.id); const current = session.getState(); if (operationId && current.projectId === board.projectId && current.branchId === board.branchId && current.document?.id === board.document?.id) setSelectedProposalId(operationId); }) : undefined,
        onSkipHeldAction: !desktopRequired && state.blockedActions.some(action => action.taskId === task.id) && (connected && task.status === 'waiting' && task.waitReason === 'overlap' || ['interrupted', 'stopped', 'failed'].includes(task.status)) ? () => run(() => controller.resolveOverlap(task.id)) : undefined,
        onRequestLivePermission: !desktopRequired && connected && active(task) && task.kind !== 'question' && currentAttempt?.status === 'working' ? (taskId, attemptId) => setGrant({ taskId, attemptId }) : undefined,
      }}
      messages={state.messages.map(message => ({ id: message.id, author: message.role === 'user' ? 'You' : message.role === 'system' ? 'Activity' : providerName(state.tasks.find(item => item.id === message.taskId)?.providerId), kind: message.role === 'user' ? 'user' : message.role === 'system' ? 'activity' : 'agent', text: message.text }))}
      awaitingAnswers={state.outstandingQuestions?.filter(question => !state.messages.some(message => message.id === question.id)).map(question => ({ id: question.id, author: providerName(state.tasks.find(item => item.id === question.taskId)?.providerId), text: question.text, onReply: !desktopRequired && connected && question.taskId ? () => { setReplyTargetId(question.taskId); setIntent('task'); requestAnimationFrame(() => composerRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()); } : undefined }))}
      review={review} feedbackDelivery={feedback && { status: feedback.delivery === 'queued' ? 'sending' : feedback.delivery, detail: feedback.delivery === 'delivered' ? 'Message delivered; agent acknowledgement has not arrived.' : feedback.delivery === 'queued' ? 'Sending message…' : feedback.delivery === 'failed' ? 'Message delivery failed. Your instruction is saved in the conversation.' : 'Message acknowledged.' }}
      composer={{ intent, text, inputLabel: intent === 'task' && replyTask ? 'Answer' : undefined, targetLabel: intent === 'feedback' ? proposal?.operationId : intent === 'task' && replyTask ? `Answer ${providerName(replyTask.providerId)} · ${replyTask.id}` : undefined, context: context.length ? context : [{ id: 'whole-board', label: 'Whole current board' }], onTextChange: setText, onIntentChange: value => { setIntent(value); if (value !== 'task') setReplyTargetId(undefined); }, onSend: !desktopRequired && connected ? send : undefined, onReplyClarification: !desktopRequired && connected && waitingQuestion && replyTargetId !== waitingQuestion.id ? () => { setReplyTargetId(waitingQuestion.id); setIntent('task'); } : undefined, onCreateDraft: !desktopRequired && isMain && intent === 'task' && !clarification ? onStartDraft : undefined, disabledReason, sending: busy, error: shownError }}
      onLoadEarlierMessages={state.hasEarlierMessages && !busy ? () => run(() => controller.loadEarlierMessages()) : undefined}
      historyWindowGap={state.historyWindowGap}
      onReturnToRecentMessages={state.historyWindowGap ? () => controller.returnToRecentMessages() : undefined}
      historyContent={readOnlyHistory && <section className="mb-3 space-y-2 text-caption" aria-label="Task proposal history"><p>All pending reviews and latest 100 saved proposals. Saved outcomes are read only; pending reviews can be dismissed.</p>{archivedProposals && archivedProposals.taskId === task?.id && archivedProposals.proposals.length === 0 && <p>No saved proposals for this task.</p>}<ul>{ownedProposals.map(entry => <li key={entry.proposal.operationId}><Button type="button" variant="link" size="sm" className="max-w-full justify-start text-left" onClick={() => setSelectedProposalId(entry.proposal.operationId)}>{entry.proposal.label} · {entry.proposal.status}</Button></li>)}</ul><Button type="button" variant="outline" size="sm" onClick={() => { setSelectedTaskId(undefined); setSelectedProposalId(undefined); }}>{editing ? 'Return to active task' : 'Return to latest task'}</Button></section>}
      history={editTasks.filter(item => item.id !== task?.id).map(item => ({ id: item.id, title: `${providerName(item.providerId)} · ${item.instruction}`, outcome: `${item.status} · ${item.permission}`, onOpen: () => { setSelectedTaskId(item.id); setSelectedProposalId(undefined); const scopeKey = JSON.stringify([board.projectId, board.branchId, board.document?.id]); run(async () => { const proposals = await controller.openTaskHistory(item.id); const current = session.getState(); if (scopeKey === JSON.stringify([current.projectId, current.branchId, current.document?.id])) setArchivedProposals({ taskId: item.id, proposals }); }); } }))}
    />
    <Dialog open={setupOpen} onOpenChange={open => { setSetupOpen(open); if (!open) setSecret(''); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Connect local agents</DialogTitle><DialogDescription>Use your installed CLIs and existing sign-in. Start the local service on this desktop.</DialogDescription></DialogHeader>
      <code className="block overflow-x-auto whitespace-pre-wrap break-all text-caption">canvas-one-agent collaborate --origin {origin}</code>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); run(async () => { const pairingSecret = secret; setSecret(''); await controller.pair(url.trim(), pairingSecret.trim()); setSetupOpen(false); }); }}>
        <Label htmlFor={`${id}-url`}>Service address</Label><Input id={`${id}-url`} value={url} onChange={event => setUrl(event.target.value)} autoComplete="off" />
        <Label htmlFor={`${id}-secret`}>Pairing secret</Label><Input id={`${id}-secret`} type="password" value={secret} onChange={event => setSecret(event.target.value)} autoComplete="off" />
        {shownError && <p role="alert" className="text-caption text-destructive">{shownError}</p>}
        <Button type="submit" disabled={!url.trim() || !secret.trim() || busy} loading={busy}>Connect</Button>
      </form>
    </DialogContent></Dialog>
    <Dialog open={Boolean(grant)} onOpenChange={open => { if (!open) setGrant(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{isMain ? 'Live editing needs a draft' : 'Allow live edit for this task?'}</DialogTitle><DialogDescription>{isMain ? 'Create or switch to a draft, then start a task there. Task permissions stay on the board where they were granted.' : 'The agent may create, change and delete content across this whole board for this task. Stop keeps completed changes. Future tasks start in Suggest.'}</DialogDescription></DialogHeader>
      <p className="break-words text-caption">{providerName(state.tasks.find(item => item.id === grant?.taskId)?.providerId)} · {state.tasks.find(item => item.id === grant?.taskId)?.instruction ?? 'This task is no longer available.'}</p>
      {isMain ? <Button type="button" onClick={() => { setGrant(null); onStartDraft(); }}>Create a draft</Button> : <Button type="button" disabled={busy} onClick={() => { const binding = grant; if (!binding) return; run(async () => { const current = controller.getState().tasks.find(item => item.id === binding.taskId); if (!current || current.attempts.at(-1)?.id !== binding.attemptId || !active(current)) throw new Error('This execution attempt is no longer active.'); await controller.grantLive(binding.taskId, binding.attemptId); setGrant(null); }); }}>Allow live edit for this task</Button>}
      <Button type="button" variant="outline" onClick={() => setGrant(null)}>Keep Suggest</Button>
      {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
    </DialogContent></Dialog>
  </div>;
}
