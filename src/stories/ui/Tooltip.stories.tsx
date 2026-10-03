import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Info, HelpCircle, GitCommit } from 'lucide-react';

const meta: Meta = {
  title: 'UI/Tooltip',
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="flex items-center gap-6 p-6">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm">
            <Info className="size-3.5" />
            FIFO Queue
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          First-in first-out message order preserved across worker nodes.
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Help">
            <HelpCircle className="size-4 text-secondary-text" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Deterministic seed guarantees identical random draws across runs.
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="sm">
            <GitCommit className="size-3.5" />
            Commit 4a8b1c
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Click to inspect simulation manifest delta and parameter changes.
        </TooltipContent>
      </Tooltip>
    </div>
  ),
};
