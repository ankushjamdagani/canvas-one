import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';

const meta: Meta = {
  title: 'UI/Resizable',
  tags: ['autodocs'],
};

export default meta;

export const HorizontalSplit: StoryObj = {
  render: () => (
    <div className="h-[320px] w-full rounded-card border border-border overflow-hidden">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize={30} minSize={20} className="p-4 bg-shell text-xs">
          <h4 className="font-semibold text-foreground mb-1">Navigation Rail</h4>
          <p className="text-secondary-text">Left dock and library explorer.</p>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} className="p-4 bg-background text-xs">
          <h4 className="font-semibold text-foreground mb-1">Canvas Viewport</h4>
          <p className="text-secondary-text">Interactive architecture diagram area.</p>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={20} minSize={15} className="p-4 bg-panel text-xs">
          <h4 className="font-semibold text-foreground mb-1">Inspector</h4>
          <p className="text-secondary-text">Properties and queue limits.</p>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};

export const VerticalSplit: StoryObj = {
  render: () => (
    <div className="h-[300px] w-full max-w-md rounded-card border border-border overflow-hidden">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel defaultSize={60} className="p-4 bg-background text-xs">
          <h4 className="font-semibold text-foreground mb-1">Live Telemetry</h4>
          <p className="text-secondary-text">Throughput chart (1,240 req/s).</p>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={40} className="p-4 bg-shell text-xs">
          <h4 className="font-semibold text-foreground mb-1">Event Logs</h4>
          <p className="text-secondary-text font-mono">[10:48:02] Attempt #1 retry OK</p>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};
