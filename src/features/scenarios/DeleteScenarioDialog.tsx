/**
 * Delete scenario confirmation dialog.
 *
 * Confirmation comes first. Saved runs of the scenario stay; the commit gate then
 * covers the remaining scenarios. Deleting is one record removal and one undo step.
 */

import { Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

export interface DeleteScenarioDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly scenarioLabel: string;
  /** Count of scenarios that will remain after this one is deleted. */
  readonly remainingCount: number;
  readonly onConfirm: () => void;
  readonly confirming?: boolean;
}

export function DeleteScenarioDialog({
  open,
  onOpenChange,
  scenarioLabel,
  remainingCount,
  onConfirm,
  confirming,
}: DeleteScenarioDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="delete-scenario-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{scenarioLabel}&rdquo;?</DialogTitle>
        </DialogHeader>

        <ul className="list-disc pl-5 space-y-1 text-xs text-body">
          <li>Its saved runs stay in history.</li>
          <li>
            Commits will need the {remainingCount} remaining scenario{remainingCount === 1 ? '' : 's'} to pass.
          </li>
          <li>Undo brings it back.</li>
        </ul>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={confirming}
            loading={confirming}
            data-testid="delete-scenario-confirm"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete scenario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
