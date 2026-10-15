import * as React from 'react';
import { ArrowUp, Check, Minus, Plus, RefreshCw, Square, Undo2, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { CanvasOneFace, type FaceExpression } from '../../components/ui/canvas-one-face';
import { Label } from '../../components/ui/label';
import { NativeSelect } from '../../components/ui/native-select';
import { Segmented } from '../../components/ui/segmented';
import { Textarea } from '../../components/ui/textarea';

export type CollaborationIntent = 'task' | 'question' | 'feedback';
export type CollaborationProvider = 'claude' | 'codex' | 'agy';
export interface CollaborationMessage {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  readonly kind: 'user' | 'agent' | 'activity';
}
export interface CollaborationReview {
  readonly id: string;
  readonly title: string;
  readonly status: 'ready' | 'stale' | 'invalid' | 'accepted' | 'rejected';
  readonly changes: readonly { readonly id: string; readonly kind: 'add' | 'change' | 'remove'; readonly label: string; readonly detail?: string }[];
  readonly issue?: string;
  readonly busy?: boolean;
  readonly onAccept?: () => void;
  readonly onReject?: () => void;
  readonly rejectLabel?: string;
  readonly onRequestChanges?: () => void;
  readonly onRefresh?: () => void;
  readonly onInspectChange?: (id: string) => void;
  readonly onFitChanges?: () => void;
  readonly comparison?: React.ReactNode;
}
export interface CollaborationPanelProps {
  readonly provider: CollaborationProvider;
  readonly providers: readonly { readonly id: CollaborationProvider; readonly label: string; readonly unavailableReason?: string }[];
  readonly onProviderChange?: (provider: CollaborationProvider) => void;
  readonly connection: {
    readonly status: 'disconnected' | 'connecting' | 'connected' | 'error' | 'desktop-required';
    readonly detail?: string;
    readonly onSetup?: () => void;
    readonly onRetry?: () => void;
    readonly onDisconnect?: () => void;
  };
  readonly task?: {
    readonly id: string;
    readonly attemptId?: string;
    readonly title: string;
    readonly status: string;
    readonly activity?: string;
    readonly permission: 'suggest' | 'live';
    readonly context: string;
    readonly expression?: FaceExpression;
    readonly interruptedSummary?: string;
    readonly cancellation?: string;
    readonly onStop?: () => void;
    readonly stopLabel?: string;
    readonly onResume?: () => void;
    readonly onEnd?: () => void;
    readonly onUndo?: () => void;
    readonly onSkipHeldAction?: () => void;
    /** Supply only while this execution attempt can request a live grant. */
    readonly onRequestLivePermission?: (taskId: string, attemptId: string) => void;
  };
  readonly messages: readonly CollaborationMessage[];
  readonly awaitingAnswers?: readonly { readonly id: string; readonly author: string; readonly text: string; readonly onReply?: () => void }[];
  readonly review?: CollaborationReview;
  readonly feedbackDelivery?: { readonly status: 'sending' | 'delivered' | 'acknowledged' | 'failed'; readonly detail: string; readonly onRetry?: () => void };
  readonly composer: {
    readonly intent: CollaborationIntent;
    readonly text: string;
    readonly inputLabel?: string;
    readonly targetLabel?: string;
    readonly context: readonly { readonly id: string; readonly label: string }[];
    readonly disabledReason?: string;
    readonly sending?: boolean;
    readonly error?: string;
    readonly onTextChange: (text: string) => void;
    readonly onIntentChange: (intent: CollaborationIntent) => void;
    readonly onRemoveContext?: (id: string) => void;
    readonly onAddSelection?: () => void;
    readonly onCreateDraft?: () => void;
    readonly onReplyClarification?: () => void;
    readonly onSend?: () => void;
  };
  readonly history?: readonly { readonly id: string; readonly title: string; readonly outcome: string; readonly onOpen?: () => void }[];
  readonly onLoadEarlierMessages?: () => void;
  readonly historyContent?: React.ReactNode;
  readonly historyWindowGap?: boolean;
  readonly onReturnToRecentMessages?: () => void;
  readonly className?: string;
}

/** Controlled presentation. The host owns execution, authorization and every board write. */
export function CollaborationPanel({ provider, providers, onProviderChange, connection, task, messages, awaitingAnswers, review, feedbackDelivery, composer, history, onLoadEarlierMessages, historyContent, historyWindowGap, onReturnToRecentMessages, className = '' }: CollaborationPanelProps) {
  const id = React.useId();
  const connected = connection.status === 'connected';
  const selectedProvider = providers.find(item => item.id === provider);
  const disabledReason = composer.disabledReason ?? selectedProvider?.unavailableReason ?? (!connected ? connection.status === 'desktop-required' ? 'Agent execution is available on desktop.' : 'Connect a local agent to send instructions.' : composer.intent === 'feedback' && !composer.targetLabel ? 'Choose a proposal to give feedback.' : undefined);
  const canSend = Boolean(composer.onSend && composer.text.trim() && !disabledReason && !composer.sending);
  const expression = task?.expression ?? (connection.status === 'connecting' ? 'antenna' : connection.status === 'error' ? 'error' : connected ? 'base' : 'sleep');
  const providerLabel = providers.find(item => item.id === provider)?.label ?? provider;
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (canSend) composer.onSend?.(); };

  return <section aria-label="AI collaboration" className={`flex h-full min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden bg-panel text-foreground max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11 max-sm:[&_select]:min-h-11 max-sm:[&_summary]:min-h-11 ${className}`} data-testid="collaboration-panel">
    <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
      <CanvasOneFace expression={expression} size={32} animate={false} transition={false} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <Label htmlFor={`${id}-provider`} className="sr-only">Agent</Label>
        <NativeSelect id={`${id}-provider`} value={provider} disabled={!onProviderChange} onChange={event => onProviderChange?.(event.target.value as CollaborationProvider)}>
          {providers.map(item => <option key={item.id} value={item.id} disabled={Boolean(item.unavailableReason)}>{item.label}{item.unavailableReason ? ` — ${item.unavailableReason}` : ''}</option>)}
        </NativeSelect>
      </div>
      {connected && connection.onDisconnect && <Button type="button" variant="ghost" size="sm" onClick={connection.onDisconnect}>Disconnect</Button>}
    </header>

    {task && <section aria-label="Current task" data-task-id={task.id} className="shrink-0 space-y-1 border-b border-hairline px-3 py-2">
      <h3 className="line-clamp-2 min-w-0 break-words font-medium" title={task.title}>{task.title}</h3>
      <p role="status" className="text-caption">{task.status}{task.activity ? ` · ${task.activity}` : ''}</p>
      <p className="text-caption text-secondary-text">Permission: {task.permission === 'live' ? 'Live edit · whole board, including deletions' : 'Suggest · review before applying'}</p>
      <p className="truncate text-caption text-secondary-text" title={task.context}>Context: {task.context}</p>
      {task.interruptedSummary && <p className="whitespace-pre-wrap break-words text-caption">{task.interruptedSummary}</p>}
      {task.cancellation && <p className="text-caption text-secondary-text">{task.cancellation}</p>}
      <div className="flex flex-wrap gap-2">
        {task.onStop && <Button type="button" variant="outline" size="sm" onClick={task.onStop}><Square aria-hidden="true" />{task.stopLabel ?? 'Stop'}</Button>}
        {task.onResume && <Button type="button" size="sm" onClick={task.onResume}>Resume task</Button>}
        {task.onEnd && <Button type="button" variant="ghost" size="sm" onClick={task.onEnd}>End task</Button>}
        {task.onUndo && <Button type="button" variant="outline" size="sm" onClick={task.onUndo}><Undo2 aria-hidden="true" />Undo task</Button>}
        {task.onSkipHeldAction && <Button type="button" variant="outline" size="sm" onClick={task.onSkipHeldAction}>Skip action and re-plan</Button>}
        {connected && task.permission === 'suggest' && !task.interruptedSummary && task.attemptId && task.onRequestLivePermission && <Button type="button" variant="outline" size="sm" onClick={() => task.onRequestLivePermission?.(task.id, task.attemptId!)}>Allow live edit for this task…</Button>}
      </div>
    </section>}

    <div role="region" className="min-h-[120px] flex-1 overflow-y-auto overscroll-contain p-3" tabIndex={0} aria-label="Conversation and proposed changes">
      {!connected && <section className="space-y-3" aria-label="Connection setup">
        <h3 className="font-medium">{connection.status === 'desktop-required' ? 'Continue on desktop' : connection.status === 'connecting' ? 'Connecting' : connection.status === 'error' ? 'Connection unavailable' : 'Connect an agent'}</h3>
        <p className="text-caption text-secondary-text">{connection.detail ?? (connection.status === 'desktop-required' ? 'You can inspect the board here. Start agent tasks on the desktop with your signed-in CLI.' : 'Install and sign in to your CLI, then start the local Canvas One service.')}</p>
        <div className="flex flex-wrap gap-2">{connection.onSetup && <Button type="button" size="sm" onClick={connection.onSetup}>Connection settings</Button>}{connection.onRetry && <Button type="button" variant="outline" size="sm" onClick={connection.onRetry}><RefreshCw aria-hidden="true" />Check again</Button>}</div>
      </section>}
      {connected && !messages.length && !task && <p className="text-caption text-secondary-text">Ask {providerLabel} a question or start a task. Suggested changes wait for your review.</p>}
      {onLoadEarlierMessages && <Button type="button" variant="outline" size="sm" onClick={onLoadEarlierMessages}>Load earlier messages</Button>}
      {historyWindowGap && <section className="my-3 space-y-2 text-caption" aria-label="Earlier history window"><p role="status">Showing an earlier history window; some newer messages are outside this view.</p>{onReturnToRecentMessages && <Button type="button" variant="outline" size="sm" onClick={onReturnToRecentMessages}>Return to recent messages</Button>}</section>}
      {historyContent}
      {awaitingAnswers && awaitingAnswers.length > 0 && <section className="my-3 space-y-2 border-y border-hairline py-3 text-caption" aria-label="Awaiting your answer"><h3 className="font-medium">Awaiting your answer</h3><ul className="space-y-3">{awaitingAnswers.map(question => <li key={question.id}><p className="font-medium">{question.author}</p><p className="whitespace-pre-wrap break-words">{question.text}</p>{question.onReply && <Button type="button" variant="outline" size="sm" onClick={question.onReply}>Answer this question</Button>}</li>)}</ul></section>}
      {history && history.length > 0 && <details className="mb-4"><summary className="cursor-pointer text-caption">Earlier tasks ({history.length})</summary><ul className="mt-2 space-y-2">{history.map(item => <li key={item.id} className="break-words text-caption">{item.onOpen ? <Button type="button" variant="link" size="sm" className="max-w-full justify-start text-left" onClick={item.onOpen}>{item.title}</Button> : <span>{item.title}</span>}<p className="text-secondary-text">{item.outcome}</p></li>)}</ul></details>}
      <ol className="space-y-4" aria-label="Messages">{messages.map(message => <li key={message.id} className={message.kind === 'activity' ? 'text-caption text-secondary-text' : 'text-caption'}><p className="mb-1 font-medium">{message.author}</p><p className="whitespace-pre-wrap break-words">{message.text}</p></li>)}</ol>
      {review && <section aria-label="Proposed changes" data-operation-id={review.id} className="mt-4 space-y-3 border-t border-hairline pt-3">
        <h3 className="break-words font-medium">{review.title}</h3><p className="break-words text-caption text-secondary-text">{review.status} · {review.changes.length} {review.changes.length === 1 ? 'change' : 'changes'}</p>
        {review.issue && <p role="alert" className="text-caption text-destructive">{review.issue}</p>}
        {review.comparison}
        <ul className="divide-y divide-hairline">{review.changes.map(change => { const Icon = change.kind === 'add' ? Plus : change.kind === 'remove' ? Minus : RefreshCw; return <li key={change.id} className="py-2 text-caption"><div className="flex items-start gap-2"><Icon className="mt-0.5 size-3 shrink-0" aria-hidden="true" /><div className="min-w-0"><p><span className="font-medium">{change.kind === 'add' ? 'Added' : change.kind === 'remove' ? 'Removed' : 'Changed'}: </span>{change.label}</p>{change.detail && <p className="whitespace-pre-wrap break-words text-secondary-text">{change.detail}</p>}{review.onInspectChange && <Button type="button" variant="link" size="sm" onClick={() => review.onInspectChange?.(change.id)}>Inspect {change.label}</Button>}</div></div></li>; })}</ul>
        {review.onFitChanges && <Button type="button" variant="outline" size="sm" onClick={review.onFitChanges}>Fit to changes</Button>}
      </section>}
      {feedbackDelivery && <div role={feedbackDelivery.status === 'failed' ? 'alert' : 'status'} className="mt-3 text-caption"><p>{feedbackDelivery.detail}</p>{feedbackDelivery.onRetry && <Button type="button" variant="outline" size="sm" onClick={feedbackDelivery.onRetry}>Retry feedback</Button>}</div>}
    </div>

    {review && review.status !== 'accepted' && review.status !== 'rejected' && <div className="flex shrink-0 flex-wrap gap-2 border-t border-hairline p-3" aria-label="Proposal actions">
      <Button type="button" size="sm" disabled={review.status !== 'ready' || !review.onAccept || review.busy} onClick={review.onAccept}><Check aria-hidden="true" />Accept changes</Button>
      {review.onRequestChanges && <Button type="button" variant="outline" size="sm" disabled={review.busy} onClick={review.onRequestChanges}>Request changes</Button>}
      {review.onRefresh && <Button type="button" variant="outline" size="sm" disabled={review.busy} onClick={review.onRefresh}>Refresh proposal</Button>}
      {review.onReject && <Button type="button" variant="ghost" size="sm" disabled={review.busy} onClick={review.onReject}><X aria-hidden="true" />{review.rejectLabel ?? 'Reject'}</Button>}
    </div>}

    <form onSubmit={submit} className="shrink-0 space-y-1 border-t border-hairline px-3 py-2">
      <Segmented aria-label="Message purpose" value={composer.intent} onChange={value => composer.onIntentChange(value as CollaborationIntent)} options={[{ id: 'task', label: 'Task', className: 'pointer-coarse:min-h-11' }, { id: 'question', label: 'Question', className: 'pointer-coarse:min-h-11' }, { id: 'feedback', label: 'Feedback', disabled: !composer.targetLabel, className: 'pointer-coarse:min-h-11' }]} />
      {composer.targetLabel && <p className="break-words text-caption">Target: {composer.targetLabel}</p>}
      {composer.onReplyClarification && <Button type="button" variant="outline" size="sm" onClick={composer.onReplyClarification}>Answer agent question</Button>}
      {composer.context.length > 0 && <details className="text-caption"><summary className="cursor-pointer truncate">Starting context · {composer.context.length} selected</summary><ul aria-label="Starting context" className="max-h-28 overflow-y-auto space-y-1">{composer.context.map(item => <li key={item.id} className="flex items-center justify-between gap-2 text-caption"><span className="min-w-0 break-words">{item.label}</span>{composer.onRemoveContext && <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${item.label} from context`} onClick={() => composer.onRemoveContext?.(item.id)}><X aria-hidden="true" /></Button>}</li>)}</ul></details>}
      <Label className="sr-only" htmlFor={`${id}-message`}>{composer.inputLabel ?? (composer.intent === 'feedback' ? 'Feedback' : composer.intent === 'question' ? 'Question' : 'Task instruction')}</Label>
      <Textarea id={`${id}-message`} value={composer.text} onChange={event => composer.onTextChange(event.target.value)} disabled={Boolean(disabledReason) || composer.sending} aria-describedby={disabledReason ? `${id}-reason` : undefined} className="min-h-16 max-h-32 resize-none" onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing && canSend) { event.preventDefault(); composer.onSend?.(); } }} />
      {disabledReason && <p id={`${id}-reason`} className="text-caption text-secondary-text">{disabledReason}</p>}
      {composer.error && <p role="alert" className="text-caption text-destructive">{composer.error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2">{composer.onCreateDraft && <Button type="button" variant="outline" size="sm" onClick={composer.onCreateDraft}>Create a draft</Button>}{composer.onAddSelection && <Button type="button" variant="ghost" size="sm" onClick={composer.onAddSelection}>Add selection</Button>}{composer.intent === 'task' && <span className="self-center text-caption text-secondary-text">New tasks start in Suggest</span>}</div><Button type="submit" size="sm" disabled={!canSend} loading={composer.sending}><ArrowUp aria-hidden="true" />Send</Button></div>
    </form>
  </section>;
}
