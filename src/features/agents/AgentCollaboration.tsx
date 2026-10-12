import * as React from 'react';
import { Check, Plug, Unplug, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import type { ModelProvider } from '@canvas-one/agents';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import type { SessionController } from '../session/controller';
import { SystemAgentSession, type AgentSelection } from './controller';
import {renderDiagramSvg} from '../transfer/svg-export';

export type AgentCollaborationProps = {
  readonly session: SessionController;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selection?: AgentSelection;
  readonly modelProvider?: ModelProvider;
};

/** App-owned review and pairing interface over the reusable headless proposal service. */
export function AgentCollaboration({ session, open, onOpenChange, selection, modelProvider }: AgentCollaborationProps) {
  const selectionRef = React.useRef(selection);
  selectionRef.current = selection;
  const [controller, setController] = React.useState<SystemAgentSession | null>(null);
  React.useEffect(() => {
    const next = new SystemAgentSession(session, () => selectionRef.current ?? { ids: [] });
    setController(next);
    return () => next.dispose();
  }, [session]);
  return controller ? <AgentCollaborationView controller={controller} session={session} open={open} onOpenChange={onOpenChange} modelProvider={modelProvider} /> : null;
}

function AgentCollaborationView({ controller, session, open, onOpenChange, modelProvider }: {
  readonly controller: SystemAgentSession; readonly open: boolean; readonly onOpenChange: (open: boolean) => void;
  readonly modelProvider?: ModelProvider;
  readonly session: SessionController;
}) {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [url, setUrl] = React.useState('http://127.0.0.1:47831');
  const [code, setCode] = React.useState('');
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [instruction, setInstruction] = React.useState('');
  const [generating, setGenerating] = React.useState(false);
  const id = React.useId();
  const connected = state.status === 'connected' || state.status === 'reconnecting';

  const accept = async (operationId: string) => {
    setActionError(null);
    const result = await controller.proposals.accept(operationId, controller.reviewer);
    if (!result.ok) setActionError(result.issues.map(({ message }) => message).join('; '));
  };
  const reject = (operationId: string) => {
    setActionError(null);
    const result = controller.proposals.reject(operationId, controller.reviewer);
    if (!result.ok) setActionError(result.issues.map(({ message }) => message).join('; '));
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-2xl" data-testid="agent-collaboration-dialog">
      <DialogHeader>
        <DialogTitle>AI collaboration</DialogTitle>
        <DialogDescription>Connect a local agent. Its changes appear here for review before they reach the board.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <section aria-label="Agent connection" className="space-y-3">
          <p className="text-caption text-secondary-text">Start the Canvas One CLI bridge with this page&apos;s origin. Enter its loopback address and short-lived pairing code.</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-address`}>Bridge address</Label>
              <Input id={`${id}-address`} value={url} onChange={(event) => setUrl(event.target.value)} disabled={connected || state.status === 'pairing'} placeholder="http://127.0.0.1:47831" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-code`}>Pairing code</Label>
              <Input id={`${id}-code`} value={code} onChange={(event) => setCode(event.target.value)} disabled={connected || state.status === 'pairing'} autoComplete="off" spellCheck={false} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {connected ? <Button variant="outline" size="sm" onClick={() => { controller.disconnect(); setCode(''); }}><Unplug />Disconnect</Button>
              : <Button size="sm" loading={state.status === 'pairing'} disabled={!url.trim() || !code.trim()} onClick={() => { void controller.pair(url, code).then(() => setCode('')); }}><Plug />Pair agent</Button>}
            <p role="status" className="text-caption text-secondary-text">{state.status === 'connected' ? `Connected to ${state.participant?.displayName ?? 'agent'}` : state.status === 'reconnecting' ? 'Reconnecting…' : state.status === 'pairing' ? 'Pairing…' : 'Disconnected'}</p>
          </div>
          {(state.error || actionError) && <p role="alert" className="text-destructive text-caption">{state.error ?? actionError}</p>}
        </section>
        {modelProvider && <section aria-label="Model collaboration" className="space-y-2">
          <Label htmlFor={`${id}-instruction`}>Ask {modelProvider.id}</Label>
          <Textarea id={`${id}-instruction`} value={instruction} onChange={event => setInstruction(event.target.value)} disabled={generating} placeholder="Explain this system on the board, or propose a change…" />
          <Button size="sm" disabled={generating || !instruction.trim()} onClick={() => {
            setActionError(null); setGenerating(true);
            void controller.proposeWithModel(modelProvider, instruction.trim()).catch(error => {
              setActionError(error instanceof Error ? error.message : 'Model could not generate a proposal');
            }).finally(() => setGenerating(false));
          }}>{generating ? 'Preparing proposal…' : 'Generate proposal'}</Button>
        </section>}
        <section aria-label="Agent proposals" className="space-y-3 border-t border-hairline pt-4">
          <h3 className="font-medium">Proposals</h3>
          {state.proposals.length === 0 ? <p className="text-caption text-secondary-text">No proposals yet. Agents can inspect this board, discover components and submit diagrams or annotations.</p>
            : state.proposals.slice().reverse().map((proposal) => <article key={proposal.operationId} className="rounded-control border border-hairline p-3 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="font-medium break-words">{proposal.label}</h4>
                <span className="text-caption text-secondary-text">{proposal.status}</span>
              </div>
              <p className="text-caption text-secondary-text">{proposal.actor.displayName} · revision {proposal.expectedRevision} · {proposal.changes.length} change{proposal.changes.length === 1 ? '' : 's'}</p>
              <ProposalDiagram controller={controller} operationId={proposal.operationId} />
              <details>
                <summary className="cursor-pointer text-caption">Review changes</summary>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words bg-sunken rounded-control p-2 text-caption mt-2">{JSON.stringify(proposal.changes, null, 2)}</pre>
              </details>
              {proposal.issues.length > 0 && <ul className="space-y-1 text-caption text-destructive">{proposal.issues.map((issue, index) => <li key={index}>{issue.path.length ? `${issue.path.join('.')}: ` : ''}{issue.message}</li>)}</ul>}
              {proposal.status === 'pending' && <div className="flex gap-2">
                <Button size="sm" onClick={() => { void accept(proposal.operationId); }}><Check />Accept changes</Button>
                <Button variant="outline" size="sm" onClick={() => reject(proposal.operationId)}><X />Reject</Button>
              </div>}
              {proposal.status === 'accepting' && <p role="status" className="text-caption text-secondary-text">Applying one reviewed transaction…</p>}
              {proposal.status === 'conflict' && <p className="text-caption text-secondary-text">The board changed. Ask the agent to inspect it and generate a new proposal.</p>}
            </article>)}
        </section>
      </div>
    </DialogContent>
  </Dialog>;
}

/** A derived image is read-only presentation; it never becomes another authored runtime. */
function ProposalDiagram({controller, operationId}: {readonly controller: SystemAgentSession; readonly operationId: string}) {
  const preview = controller.proposals.preview(operationId);
  if (preview.status === 'stale') return <p className="text-caption text-secondary-text">The board changed. Ask the agent to regenerate this proposal.</p>;
  if (preview.status !== 'ready') return null;
  const proposal = controller.proposals.inspect(operationId);
  const viewChange = proposal?.changes.find(change => change.kind !== 'remove' && change.value.recordKind === 'view');
  const viewId = viewChange && viewChange.kind !== 'remove' ? viewChange.value.record.id : preview.document.views[0]?.id;
  let svg: string;
  try {svg = renderDiagramSvg(preview.document, viewId);} catch {return <p className="text-caption text-secondary-text">Diagram preview unavailable. Review the record changes.</p>;}
  return <figure className="space-y-1.5">
    <figcaption className="text-caption text-secondary-text">Proposal preview · revision {preview.revision}</figcaption>
    <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="Proposed board diagram" loading="lazy" className="w-full max-h-64 rounded-control border border-hairline" data-testid="agent-proposal-preview" />
  </figure>;
}
