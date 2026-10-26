import * as React from 'react';
import { ComposerPrimitive, ThreadPrimitive } from '@assistant-ui/react';
import { AssistantConversation, AssistantMessage } from './AssistantConversation';
import { ArrowUp, Check, ChevronDown, Minus, Plus, RefreshCw, Square, Undo2, X, Unplug } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { CanvasOneFace, type FaceExpression } from '../../components/ui/canvas-one-face';
import { Label } from '../../components/ui/label';
import { NativeSelect } from '../../components/ui/native-select';
import { Segmented } from '../../components/ui/segmented';
import { Textarea } from '../../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';

export type CollaborationIntent = 'task' | 'question' | 'feedback';
export type CollaborationProvider = 'claude' | 'codex' | 'agy';
export interface CollaborationMessage {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  readonly kind: 'user' | 'agent' | 'activity';
  readonly taskId?: string;
  readonly attemptId?: string;
  readonly important?: boolean;
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
    readonly setup?: React.ReactNode;
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
    readonly liveScopeLabel?: string;
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
  readonly activity?: string;
  readonly activityLog?: readonly { readonly id: string; readonly label: string; readonly status: string }[];
  readonly responseControls?: readonly { readonly id: string; readonly label: string; readonly onStop: () => void }[];
  readonly awaitingAnswers?: readonly { readonly id: string; readonly author: string; readonly text: string; readonly onReply?: () => void }[];
  readonly review?: CollaborationReview;
  readonly feedbackDelivery?: { readonly status: 'sending' | 'delivered' | 'acknowledged' | 'failed'; readonly detail: string; readonly onRetry?: () => void };
  readonly composer: {
    readonly intent: CollaborationIntent;
    readonly permissionMode?: 'read' | 'write';
    readonly writeBehavior?: 'suggest' | 'live';
    readonly permissionDetail?: string;
    readonly onPermissionModeChange?: (mode: 'read' | 'write') => void;
    readonly onWriteBehaviorChange?: (behavior: 'suggest' | 'live') => void;
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
    readonly onSend?: (text?: string) => void | Promise<void>;
  };
  readonly history?: readonly { readonly id: string; readonly title: string; readonly outcome: string; readonly onOpen?: () => void }[];
  readonly onLoadEarlierMessages?: () => void;
  readonly historyContent?: React.ReactNode;
  readonly historyWindowGap?: boolean;
  readonly onReturnToRecentMessages?: () => void;
  readonly className?: string;
}

/** Controlled presentation. The host owns execution, authorization and every board write. */
export function CollaborationPanel({ provider, providers, onProviderChange, connection, task, messages, activity, activityLog, responseControls, awaitingAnswers, review, feedbackDelivery, composer, history, onLoadEarlierMessages, historyContent, historyWindowGap, onReturnToRecentMessages, className = '' }: CollaborationPanelProps) {
  const id = React.useId();
  const connected = connection.status === 'connected';
  const selectedProvider = providers.find(item => item.id === provider);
  const disabledReason = composer.disabledReason ?? selectedProvider?.unavailableReason ?? (!connected ? connection.status === 'desktop-required' ? 'Agent execution is available on desktop.' : 'Connect a local agent to send instructions.' : undefined);
  const canSend = Boolean(composer.onSend && composer.text.trim() && !disabledReason && !composer.sending);
  const expression = task?.expression ?? (connection.status === 'connecting' ? 'antenna' : connection.status === 'error' ? 'error' : connected ? 'base' : 'sleep');
  const providerLabel = providers.find(item => item.id === provider)?.label ?? provider;
  const diagnostics = messages.filter(message => message.kind === 'activity' && !message.important);
  const mode = composer.permissionMode ?? (composer.intent === 'question' ? 'read' : 'write');
  const behavior = composer.writeBehavior ?? 'suggest';
  const representedTask = task;
  const executing = Boolean(representedTask && ['requested', 'working'].includes(representedTask.status.toLowerCase()) && representedTask.onStop);
  const questionResponse = !task && !composer.text.trim() ? responseControls?.at(-1) : undefined;
  const stopAction = !composer.text.trim() ? questionResponse?.onStop ?? (executing ? representedTask?.onStop : undefined) : undefined;
  const stopLabel = 'Stop request';
  const viewport = React.useRef<HTMLDivElement>(null);
  const nearBottom = React.useRef(true);
  const previousFirst = React.useRef(messages[0]?.id);
  const previousHeight = React.useRef(0);
  React.useLayoutEffect(() => {
    const element = viewport.current;
    const prepended = Boolean(previousFirst.current && previousFirst.current !== messages[0]?.id && messages.some(message => message.id === previousFirst.current));
    previousFirst.current = messages[0]?.id;
    if (!element) return;
    if (prepended) element.scrollTop += element.scrollHeight - previousHeight.current;
    else if (nearBottom.current) element.scrollTop = element.scrollHeight;
    previousHeight.current = element.scrollHeight;
  }, [messages, review, awaitingAnswers]);

  return <AssistantConversation messages={messages} composer={{ ...composer, disabledReason }}><section aria-label="AI collaboration" className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel text-foreground max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11 max-sm:[&_select]:min-h-11 max-sm:[&_summary]:min-h-11 ${className}`} data-testid="collaboration-panel">

    {connected && task && <section aria-label="Current request" data-task-id={task.id} className="shrink-0 space-y-1 border-b border-hairline px-3 py-2">
      <details><summary className="cursor-pointer truncate text-caption">{mode === 'read' ? 'Read' : task.permission === 'live' ? 'Write / Live' : 'Write / Suggest'} · Request details</summary><h3 className="break-words font-medium">{task.title}</h3><p className="text-caption text-secondary-text">{task.context}</p><p className="text-caption">{mode === 'read' ? 'Inspect and explain only' : task.permission === 'live' ? task.liveScopeLabel ?? 'Whole board, including deletions' : 'Review before applying'}</p></details>
      {task.interruptedSummary && <p className="whitespace-pre-wrap break-words text-caption">Work paused. Completed changes remain. Resume to continue.</p>}
      {task.activity && <p role="alert" className="text-caption">{task.activity}</p>}
      {task.status === 'failed' && <p role="alert" className="text-caption text-destructive">Agent stopped with an error. Check Details before resuming.</p>}
      {task.cancellation?.includes('not been acknowledged') && <p className="text-caption text-secondary-text">Board writes stopped. Waiting for agent cancellation.</p>}
      <div className="flex flex-wrap gap-2">
        {task.onStop && (!executing || Boolean(composer.text.trim())) && <Button type="button" variant="outline" size="sm" onClick={task.onStop}><Square aria-hidden="true" />{task.stopLabel ?? 'Stop request'}</Button>}
        {task.onResume && <Button type="button" size="sm" onClick={task.onResume}>Resume request</Button>}
        {task.onEnd && <Button type="button" variant="ghost" size="sm" onClick={task.onEnd}>End request</Button>}
        {task.onUndo && <Button type="button" variant="outline" size="sm" onClick={task.onUndo} title="Review a reversal before applying it"><Undo2 aria-hidden="true" />Review undo</Button>}
        {task.onSkipHeldAction && <Button type="button" variant="outline" size="sm" onClick={task.onSkipHeldAction}>Skip action and re-plan</Button>}
      </div>
    </section>}

    <div ref={viewport} onScroll={event => { const element = event.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64; }} role="region" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3" tabIndex={0} aria-label="Conversation and proposed changes">
      {!connected && (connection.setup ?? <section className="space-y-3" aria-label="Connection setup">
        <h3 className="font-medium">{connection.status === 'desktop-required' ? 'Continue on desktop' : connection.status === 'connecting' ? 'Connecting' : connection.status === 'error' ? 'Connection unavailable' : 'Connect an agent'}</h3>
        <p className="text-caption text-secondary-text">{connection.detail ?? (connection.status === 'desktop-required' ? 'You can inspect the board here. Start agent tasks on the desktop with your signed-in CLI.' : 'Install and sign in to your CLI, then start the local Canvas One service.')}</p>
        <div className="flex flex-wrap gap-2">{connection.onSetup && <Button type="button" size="sm" onClick={connection.onSetup}>Connection settings</Button>}{connection.onRetry && <Button type="button" variant="outline" size="sm" onClick={connection.onRetry}><RefreshCw aria-hidden="true" />Check again</Button>}</div>
      </section>)}
      <>
      {!messages.length && !task && <p className="text-caption text-secondary-text">Tell {providerLabel} what you need. Questions and feedback belong in this conversation. Suggested changes wait for your review.</p>}
      {onLoadEarlierMessages && <Button type="button" variant="outline" size="sm" onClick={onLoadEarlierMessages}>Load earlier messages</Button>}
      {historyWindowGap && <section className="my-3 space-y-2 text-caption" aria-label="Earlier history window"><p role="status">Showing an earlier history window; some newer messages are outside this view.</p>{onReturnToRecentMessages && <Button type="button" variant="outline" size="sm" onClick={onReturnToRecentMessages}>Return to recent messages</Button>}</section>}
      {historyContent}
      {awaitingAnswers && awaitingAnswers.length > 0 && <section className="my-3 space-y-2 border-y border-hairline py-3 text-caption" aria-label="Awaiting your answer"><h3 className="font-medium">Awaiting your answer</h3><ul className="space-y-3">{awaitingAnswers.map(question => <li key={question.id}><p className="font-medium">{question.author}</p><p className="whitespace-pre-wrap break-words">{question.text}</p>{question.onReply && <Button type="button" variant="outline" size="sm" onClick={question.onReply}>Answer this question</Button>}</li>)}</ul></section>}
      {history && history.length > 0 && <details className="mb-4"><summary className="cursor-pointer text-caption">Earlier requests ({history.length})</summary><ul className="mt-2 space-y-2">{history.map(item => <li key={item.id} className="break-words text-caption">{item.onOpen ? <Button type="button" variant="link" size="sm" className="max-w-full justify-start text-left" onClick={item.onOpen}>{item.title}</Button> : <span>{item.title}</span>}<p className="text-secondary-text">{item.outcome}</p></li>)}</ul></details>}
      <ol className="space-y-4" aria-label="Messages"><ThreadPrimitive.Messages components={{ Message: AssistantMessage }} /></ol>
      {responseControls?.filter(response => response.id !== task?.id).map(response => <div key={response.id} className="mt-2 flex items-center justify-between gap-2 text-caption"><span>{response.label}</span><Button type="button" size="sm" variant="outline" onClick={response.onStop}>Stop request</Button></div>)}
      {review && <section aria-label="Proposed changes" data-operation-id={review.id} className="mt-4 space-y-3 border-t border-hairline pt-3">
        <h3 className="break-words font-medium">{review.title}</h3><p className="break-words text-caption text-secondary-text">{review.status} · {review.changes.length} {review.changes.length === 1 ? 'change' : 'changes'}</p>
        {review.issue && <p role="alert" className="text-caption text-destructive">{review.issue}</p>}
        {review.comparison}
        <ul className="divide-y divide-hairline">{review.changes.map(change => { const Icon = change.kind === 'add' ? Plus : change.kind === 'remove' ? Minus : RefreshCw; return <li key={change.id} className="py-2 text-caption"><div className="flex items-start gap-2"><Icon className="mt-0.5 size-3 shrink-0" aria-hidden="true" /><div className="min-w-0"><p><span className="font-medium">{change.kind === 'add' ? 'Added' : change.kind === 'remove' ? 'Removed' : 'Changed'}: </span>{change.label}</p>{change.detail && <p className="whitespace-pre-wrap break-words text-secondary-text">{change.detail}</p>}{review.onInspectChange && <Button type="button" variant="link" size="sm" onClick={() => review.onInspectChange?.(change.id)}>Inspect {change.label}</Button>}</div></div></li>; })}</ul>
        {review.onFitChanges && <Button type="button" variant="outline" size="sm" onClick={review.onFitChanges}>Fit to changes</Button>}
      </section>}
      {feedbackDelivery?.status === 'failed' && <div role="alert" className="mt-3 text-caption"><p>{feedbackDelivery.detail}</p>{feedbackDelivery.onRetry && <Button type="button" variant="outline" size="sm" onClick={feedbackDelivery.onRetry}>Retry feedback</Button>}</div>}
      </>
    </div>

    {review && review.status !== 'accepted' && review.status !== 'rejected' && <div className="flex shrink-0 flex-wrap gap-2 border-t border-hairline p-3" aria-label="Proposal actions">
      <Button type="button" size="sm" disabled={review.status !== 'ready' || !review.onAccept || review.busy} onClick={review.onAccept}><Check aria-hidden="true" />Accept changes</Button>
      {review.onRequestChanges && <Button type="button" variant="outline" size="sm" disabled={review.busy} onClick={review.onRequestChanges}>Request changes</Button>}
      {review.onRefresh && <Button type="button" variant="outline" size="sm" disabled={review.busy} onClick={review.onRefresh}>Refresh proposal</Button>}
      {review.onReject && <Button type="button" variant="ghost" size="sm" disabled={review.busy} onClick={review.onReject}><X aria-hidden="true" />{review.rejectLabel ?? 'Reject'}</Button>}
    </div>}

    {connected && <><div className="shrink-0 px-3 text-caption">{activity && <p role="status" className="truncate py-1">{activity}</p>}{(diagnostics.length > 0 || activityLog?.length) ? <details><summary className="cursor-pointer py-1 text-secondary-text">Details</summary><div className="max-h-32 space-y-1 overflow-y-auto pb-2"><p className="text-secondary-text">Saved diagnostics and latest session activity</p>{diagnostics.map(item => <p key={item.id} className="whitespace-pre-wrap break-words">{item.text}</p>)}{activityLog?.slice(-100).map(item => <p key={item.id}>{item.label} · {item.status}</p>)}</div></details> : null}</div><ComposerPrimitive.Root className="shrink-0 space-y-1 border-t border-hairline px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented aria-label="AI permission" value={mode} onChange={value => composer.onPermissionModeChange ? composer.onPermissionModeChange(value as 'read' | 'write') : composer.onIntentChange(value === 'read' ? 'question' : 'task')} options={[{ id: 'read', label: 'Read', disabled: composer.sending, className: 'pointer-coarse:min-h-11' }, { id: 'write', label: 'Write', disabled: composer.sending, className: 'pointer-coarse:min-h-11' }]} />
        {mode === 'write' && <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost" disabled={composer.sending} aria-label={`Write behavior: ${behavior === 'live' ? 'Live' : 'Suggest'}`}>{behavior === 'live' ? 'Live' : 'Suggest'}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuRadioGroup value={behavior} onValueChange={value => composer.onWriteBehaviorChange?.(value as 'suggest' | 'live')}><DropdownMenuRadioItem value="suggest">Suggest · approve changes first</DropdownMenuRadioItem><DropdownMenuRadioItem value="live">Live · permission for each request</DropdownMenuRadioItem></DropdownMenuRadioGroup>{task?.permission === 'suggest' && task.attemptId && task.onRequestLivePermission && <DropdownMenuItem onSelect={() => task.onRequestLivePermission?.(task.id, task.attemptId!)}>Allow Live for current request…</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}
      </div>
      {composer.permissionDetail && <p className="text-caption text-secondary-text">{composer.permissionDetail}</p>}
      {composer.targetLabel && <p className="break-words text-caption">Target: {composer.targetLabel}</p>}
      {composer.onReplyClarification && <Button type="button" variant="outline" size="sm" onClick={composer.onReplyClarification}>Answer agent question</Button>}
      {composer.context.length > 0 && <details className="text-caption"><summary className="cursor-pointer truncate">Starting context · {composer.context.length === 1 && composer.context[0]?.id === 'whole-board' ? 'Whole board' : `${composer.context.length} selected`}</summary><ul aria-label="Starting context" className="max-h-28 overflow-y-auto space-y-1">{composer.context.map(item => <li key={item.id} className="flex items-center justify-between gap-2 text-caption"><span className="min-w-0 break-words">{item.label}</span>{composer.onRemoveContext && <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${item.label} from context`} onClick={() => composer.onRemoveContext?.(item.id)}><X aria-hidden="true" /></Button>}</li>)}</ul></details>}
      <Label className="sr-only" htmlFor={`${id}-message`}>{composer.inputLabel ?? 'Message'}</Label>
      <ComposerPrimitive.Input asChild id={`${id}-message`} submitMode="ctrlEnter" addAttachmentOnPaste={false} cancelOnEscape={false} unstable_focusOnRunStart={false} unstable_focusOnScrollToBottom={false} unstable_focusOnThreadSwitched={false} onChange={event => composer.onTextChange(event.target.value)} disabled={composer.sending} aria-describedby={disabledReason ? `${id}-reason` : undefined}><Textarea className="min-h-16 max-h-32 resize-none" /></ComposerPrimitive.Input>
      {disabledReason && <p id={`${id}-reason`} className="text-caption text-secondary-text">{disabledReason}</p>}
      {composer.error && <p role="alert" className="text-caption text-destructive">{composer.error}</p>}
      {(composer.onCreateDraft || composer.onAddSelection) && <div className="flex flex-wrap items-center gap-2">{composer.onCreateDraft && <Button type="button" variant="outline" size="sm" onClick={composer.onCreateDraft}>Create a draft</Button>}{composer.onAddSelection && <Button type="button" variant="ghost" size="sm" onClick={composer.onAddSelection}>Add selection</Button>}</div>}
      <TooltipProvider><div className="flex items-center justify-end gap-2 pt-1" data-testid="agent-send-controls">
        <div className="flex min-w-0 max-w-48 flex-1 items-center">
          <Label htmlFor={`${id}-provider`} className="sr-only">Agent</Label>
          <NativeSelect id={`${id}-provider`} wrapperClassName="min-w-0 flex-1" className={connection.onDisconnect ? 'min-w-0 rounded-r-none' : 'min-w-0'} value={provider} disabled={!onProviderChange} onChange={event => onProviderChange?.(event.target.value as CollaborationProvider)}>
            {providers.map(item => <option key={item.id} value={item.id} disabled={Boolean(item.unavailableReason)}>{item.label}{item.unavailableReason ? ` — ${item.unavailableReason}` : ''}</option>)}
          </NativeSelect>
          {connection.onDisconnect && <Tooltip><TooltipTrigger asChild><Button type="button" variant="destructive" size="icon" className="shrink-0 rounded-l-none" aria-label="Disconnect" onClick={connection.onDisconnect}><Unplug aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>Disconnect local agents</TooltipContent></Tooltip>}
        </div>
        <Tooltip><TooltipTrigger asChild>{stopAction ? <Button type="button" size="icon" className="group relative" aria-label={stopLabel} onClick={stopAction}><span className="group-hover:opacity-0 group-focus-visible:opacity-0"><CanvasOneFace expression={questionResponse ? 'squint' : expression} size={28} aria-hidden="true" /></span><Square aria-hidden="true" className="absolute opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" /></Button> : <Button type="submit" size="icon" aria-label="Send" disabled={!canSend} loading={composer.sending}>{representedTask && ['waiting', 'failed', 'interrupted'].some(status => representedTask.status.toLowerCase().startsWith(status)) && !canSend ? <CanvasOneFace expression={expression} size={28} animate={false} aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}</Button>}</TooltipTrigger><TooltipContent>{stopAction ? stopLabel : 'Send message'}</TooltipContent></Tooltip>
      </div></TooltipProvider>
    </ComposerPrimitive.Root></>}
  </section></AssistantConversation>;
}
