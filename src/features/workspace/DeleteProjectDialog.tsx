import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import type { StudioRepository } from "../../persistence/studio/types";
import { formatStudioError } from "../session/formatError";

export interface DeleteProjectDialogProps {
  readonly repository: StudioRepository;
  readonly projectId: string;
  readonly mainBranchId: string;
  readonly projectTitle: string;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}

/**
 * Confirms and deletes the open project. The main head read here is the CAS token,
 * so a concurrent change to main refuses the delete instead of losing it. Lazy
 * loaded (Workspace chunk budget); mounted only while open.
 */
export function DeleteProjectDialog({
  repository,
  projectId,
  mainBranchId,
  projectTitle,
  onClose,
  onDeleted,
}: DeleteProjectDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const history = await repository.loadHistory(projectId);
      const main = history.branches.find((b) => b.id === mainBranchId);
      const res = await repository.deleteProject(
        projectId,
        main?.headCommitId ?? null,
      );
      if (res.status === "applied" || res.status === "missing") {
        onDeleted();
        return;
      }
      setError(
        res.status === "stale"
          ? "Main changed while deleting. Try again."
          : formatStudioError(res, "Could not delete project"),
      );
    } catch (err) {
      console.error("Failed to delete project:", err);
      setError("Could not delete project");
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent data-testid="delete-project-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{projectTitle}&rdquo;?</DialogTitle>
          <DialogDescription>
            This removes the project with all its branches, history and runs.
            It can&rsquo;t be undone.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void confirm()}
            disabled={busy}
            loading={busy}
            data-testid="delete-project-confirm"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
