import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { InlineAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, AlertTriangle } from 'lucide-react';

const meta: Meta = {
  title: 'Patterns/Destructive Prompt Dialog',
  parameters: {
    layout: 'centered',
  },
};

export default meta;

export const DestructiveDeleteRecipe: StoryObj = {
  name: 'Destructive Action Confirmation',
  render: () => {
    return (
      <Dialog defaultOpen>
        <DialogTrigger asChild>
          <Button variant="destructive" className="gap-1.5">
            <Trash2 className="size-4" />
            <span>Delete Scenario</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="risk">IRREVERSIBLE ACTION</Badge>
            </div>
            <DialogTitle className="text-ink">Delete Simulation Scenario?</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete <strong className="text-ink font-semibold">"Peak Black Friday Traffic Surge"</strong>?
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <InlineAlert
              tone="risk"
              title="Simulation telemetry and benchmarks will be erased"
              detail="This scenario contains 12 historical simulation runs and custom traffic schedules. Deleted scenarios cannot be recovered."
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="secondary">Keep Scenario</Button>
            <Button variant="destructive" className="gap-1.5">
              <Trash2 className="size-3.5" />
              <span>Permanently Delete</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
};
