import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { MousePointer, Hand, Play, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

const meta: Meta = {
  title: 'Patterns/Toolbar & Action Bar',
  parameters: {
    layout: 'centered',
  },
};

export default meta;

export const CanvasToolbarRecipe: StoryObj = {
  name: 'Canvas Interaction Toolbar',
  render: () => {
    const [tool, setTool] = React.useState('select');

    return (
      <div className="flex items-center gap-2 rounded-popover border border-border bg-background p-1.5 shadow-floating">
        {/* Pointer Mode Segmented */}
        <Segmented
          value={tool}
          onChange={setTool}
          options={[
            {
              id: 'select',
              label: (
                <span className="flex items-center gap-1.5 text-xs">
                  <MousePointer className="size-3.5" />
                  <span>Select</span>
                </span>
              ),
            },
            {
              id: 'pan',
              label: (
                <span className="flex items-center gap-1.5 text-xs">
                  <Hand className="size-3.5" />
                  <span>Pan</span>
                </span>
              ),
            },
          ]}
        />

        <Separator orientation="vertical" className="h-5 bg-hairline" />

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="size-7 p-0">
                <ZoomOut className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom Out</TooltipContent>
          </Tooltip>

          <span className="font-mono text-xs text-secondary-text px-1 min-w-[42px] text-center select-none">
            100%
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="size-7 p-0">
                <ZoomIn className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom In</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="size-7 p-0">
                <Maximize2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to Screen</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-5 bg-hairline" />

        {/* Primary Simulation Trigger */}
        <Button variant="default" size="sm" className="h-7 text-xs px-3 gap-1.5">
          <Play className="size-3 fill-current" />
          <span>Simulate</span>
        </Button>
      </div>
    );
  },
};
