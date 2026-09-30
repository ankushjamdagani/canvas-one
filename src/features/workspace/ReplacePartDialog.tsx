/**
 * selection.replace-part (commands.md "Selection-scoped actions", board 16D): pick a
 * catalog entry, review what moves and what is removed, then confirm. The replacement is
 * one model change (one undo); nothing is written until Confirm.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LibraryPicker } from '../library/LibraryPicker';
import type { ReplacePlan } from './replacePlan';

export interface ReplacePartDialogProps {
  /** Label of the element being replaced; null closes the dialog. */
  readonly targetLabel: string | null;
  /** Builds the plan for a chosen catalog entry against the current document. */
  readonly plan: (entryId: string) => { readonly ok: true; readonly plan: ReplacePlan } | { readonly ok: false; readonly reason: string };
  readonly onConfirm: (plan: ReplacePlan) => Promise<{ readonly ok: boolean; readonly message?: string }>;
  readonly onClose: () => void;
}

export function ReplacePartDialog({ targetLabel, plan, onConfirm, onClose }: ReplacePartDialogProps) {
  const [entryId, setEntryId] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ReturnType<ReplacePartDialogProps['plan']> | null>(null);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const open = targetLabel !== null;

  React.useEffect(() => {
    if (!open) {
      setEntryId(null);
      setResult(null);
      setError(null);
      setApplying(false);
    }
  }, [open]);

  const choose = (id: string) => {
    setEntryId(id);
    setError(null);
    setResult(plan(id));
  };

  const confirm = async () => {
    if (!result || !result.ok || result.plan.blockedReason) return;
    setApplying(true);
    const outcome = await onConfirm(result.plan);
    setApplying(false);
    if (outcome.ok) onClose();
    else setError(outcome.message ?? 'Could not replace this part');
  };

  const ready = result?.ok ? result.plan : null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent data-testid="replace-part-dialog" className="max-w-[min(680px,calc(100vw-24px))] p-4 gap-3">
        <DialogHeader>
          <DialogTitle>Replace {targetLabel}</DialogTitle>
          <DialogDescription>
            Choose a component. Connections and scenario references move to matching ports; anything that can't move is listed before you confirm.
          </DialogDescription>
        </DialogHeader>

        {!entryId ? (
          <LibraryPicker
            onPlace={choose}
            actionLabel="Use"
            onClose={onClose}
            className="border-0 shadow-none"
          />
        ) : result && !result.ok ? (
          <p data-testid="replace-part-error" className="text-xs text-risk-text">{result.reason}</p>
        ) : ready ? (
          <div data-testid="replace-part-preview" className="space-y-2 text-xs">
            <p className="text-ink">
              {ready.movedConnectionIds.length} connection{ready.movedConnectionIds.length === 1 ? '' : 's'} move to the new component.
            </p>
            {ready.removedConnectionIds.length > 0 ? (
              <p className="text-risk-text">
                {ready.removedConnectionIds.length} connection{ready.removedConnectionIds.length === 1 ? '' : 's'} can't move and will be removed.
              </p>
            ) : null}
            {ready.scenarioRepairSummaries.map((line) => (
              <p key={line} className="text-risk-text">{line}</p>
            ))}
            {ready.affectedScenarioLabels.length > 0 ? (
              <p className="text-secondary-text">Scenarios updated: {ready.affectedScenarioLabels.join(', ')}</p>
            ) : null}
            {ready.blockedReason ? (
              <p data-testid="replace-part-blocked" className="text-risk-text">Can't replace: {ready.blockedReason}</p>
            ) : null}
          </div>
        ) : null}

        {error ? <p role="alert" className="text-xs text-risk-text">{error}</p> : null}

        <DialogFooter className="gap-2">
          {entryId ? (
            <Button type="button" variant="outline" size="sm" onClick={() => { setEntryId(null); setResult(null); }}>
              Back
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          {entryId ? (
            <Button
              type="button"
              size="sm"
              data-testid="replace-part-confirm"
              disabled={!ready || Boolean(ready.blockedReason) || applying}
              onClick={() => void confirm()}
            >
              Replace
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
