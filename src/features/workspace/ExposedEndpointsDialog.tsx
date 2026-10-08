import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import type { ExposedContract } from '../../domain/studio/exposure';
import { describeCalleeContract } from '../../domain/studio/port-settings';
import { describeEndpoint, type Protocol } from '../../domain/studio/protocols';

export type EndpointCandidate = {
  readonly key: string;
  readonly channel: 'call' | 'message' | 'data';
  readonly protocol: Protocol;
  readonly path: string;
  readonly exposed: boolean;
  /** The declared contract published with the endpoint (what its nodes promise), if any. */
  readonly contract?: ExposedContract;
  /** Nodes of this project that accept the type (empty when it is exposed but no node accepts it any more). */
  readonly nodeLabels: readonly string[];
};

export interface ExposedEndpointsDialogProps {
  readonly open: boolean;
  readonly projectTitle: string;
  readonly candidates: readonly EndpointCandidate[];
  /** Resolves to an error message when the change failed, or null on success. */
  readonly onToggle: (candidate: EndpointCandidate, exposed: boolean) => Promise<string | null>;
  readonly onClose: () => void;
}

/** Choose which inbound ports of this project other projects may connect to when they link it. */
export function ExposedEndpointsDialog({ open, projectTitle, candidates, onToggle, onClose }: ExposedEndpointsDialogProps) {
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent data-testid="exposed-endpoints-dialog" className="max-w-[min(520px,calc(100vw-24px))] p-4 gap-3">
        <DialogHeader>
          <DialogTitle>Exposed endpoints</DialogTitle>
          <DialogDescription>
            Projects that link {projectTitle} can connect only to the endpoints you expose here (type and path). An
            endpoint is listed once a node of this project accepts it: connect to a node with that type and path first.
            The contract a node declares (expected p95, availability, and so on) is published with it; switch an
            endpoint off and on to publish a change.
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="py-4 text-center text-xs text-secondary-text">No node of this project accepts a connection yet.</p>
        ) : (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
            {candidates.map((candidate) => (
              <li
                key={candidate.key}
                className="flex items-center gap-2 rounded-card border border-control-border bg-background px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{describeEndpoint(candidate.protocol, candidate.path)}</div>
                  <div className="truncate font-mono text-[10px] text-secondary-text">
                    {candidate.channel} · {candidate.nodeLabels.length > 0 ? [...new Set(candidate.nodeLabels)].join(', ') : 'no node accepts it now'}
                  </div>
                  {candidate.contract ? (
                    <div className="truncate text-[11px] text-secondary-text">
                      Publishes: {describeCalleeContract({ settings: candidate.contract })}
                    </div>
                  ) : null}
                </div>
                <Switch
                  data-testid={`expose-${candidate.key}`}
                  aria-label={`Expose ${describeEndpoint(candidate.protocol, candidate.path)}`}
                  checked={candidate.exposed}
                  onCheckedChange={(next) => {
                    void onToggle(candidate, next).then(setError);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
