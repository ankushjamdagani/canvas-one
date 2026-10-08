import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_TEAM_MAX_LENGTH } from '../../persistence/studio/types';

export type ProjectDetails = { readonly description: string; readonly team: string };

export interface ProjectDetailsDialogProps {
  readonly open: boolean;
  readonly projectTitle: string;
  readonly initial: ProjectDetails;
  /** Resolves to an error message when the save failed, or null on success. */
  readonly onSave: (details: ProjectDetails) => Promise<string | null>;
  readonly onClose: () => void;
}

/** Project settings: the description and team other projects show when they link here. */
export function ProjectDetailsDialog({ open, projectTitle, initial, onSave, onClose }: ProjectDetailsDialogProps) {
  const [description, setDescription] = React.useState(initial.description);
  const [team, setTeam] = React.useState(initial.team);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setDescription(initial.description);
      setTeam(initial.team);
      setError(null);
    }
  }, [open, initial.description, initial.team]);

  const save = async () => {
    setSaving(true);
    const message = await onSave({ description, team });
    setSaving(false);
    if (message) setError(message);
    else onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent data-testid="project-details-dialog" className="max-w-[min(480px,calc(100vw-24px))] p-4 gap-3">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            Shown on the node when another project links to {projectTitle}.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-team-input">Team</Label>
            <Input
              id="project-team-input"
              data-testid="project-team-input"
              value={team}
              maxLength={PROJECT_TEAM_MAX_LENGTH}
              placeholder="e.g. Payments platform"
              onChange={(event) => setTeam(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-description-input">Description</Label>
            <Textarea
              id="project-description-input"
              data-testid="project-description-input"
              value={description}
              maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
              rows={4}
              placeholder="What this system does and who depends on it"
              onChange={(event) => setDescription(event.target.value)}
            />
            <span className="self-end font-mono text-[10px] text-secondary-text">
              {description.length}/{PROJECT_DESCRIPTION_MAX_LENGTH}
            </span>
          </div>
          {error ? <p role="alert" className="text-xs text-risk-text">{error}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" data-testid="project-details-save" disabled={saving}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
