/**
 * Apply / Discard / Stay navigation guard dialog (RV-05b).
 *
 * commands.md §6: "Dirty -> Apply / Discard / Stay: Apply proceeds only on success,
 * Discard cancels then proceeds, and Stay keeps focus and selection." Uses shadcn
 * Dialog (focus trap, title, description, focus return) per commands.md §7.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';

export interface NavigationGuardDialogProps {
  readonly open: boolean;
  readonly onApply: () => void;
  readonly onDiscard: () => void;
  readonly onStay: () => void;
  readonly applying: boolean;
}

export function NavigationGuardDialog({ open, onApply, onDiscard, onStay, applying }: NavigationGuardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onStay(); }}>
      <DialogContent data-testid="inspector-guard-dialog" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Unsaved configuration changes</DialogTitle>
          <DialogDescription>
            Apply your changes, discard them, or stay and keep editing.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end gap-2">
          <Button type="button" variant="ghost" data-testid="guard-stay" onClick={onStay} disabled={applying}>
            Stay
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="guard-discard"
            onClick={onDiscard}
            disabled={applying}
          >
            Discard
          </Button>
          <Button type="button" data-testid="guard-apply" onClick={onApply} disabled={applying}>
            {applying ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
