import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const meta: Meta<typeof Tabs> = {
  title: 'UI/Tabs',
  component: Tabs,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof Tabs> = {
  render: () => (
    <Tabs defaultValue="architecture" className="w-[480px]">
      <TabsList>
        <TabsTrigger value="architecture">Architecture</TabsTrigger>
        <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="architecture" className="p-4 rounded-card border border-border bg-shell text-xs space-y-2">
        <h4 className="font-semibold text-foreground">Canvas Architecture</h4>
        <p className="text-secondary-text">Configure nodes, ports, queues, and deterministic retry bounds.</p>
      </TabsContent>
      <TabsContent value="scenarios" className="p-4 rounded-card border border-border bg-shell text-xs space-y-2">
        <h4 className="font-semibold text-foreground">Scenarios & Workloads</h4>
        <p className="text-secondary-text">Define traffic schedules: steady rate, flash sales, and ramp spikes.</p>
      </TabsContent>
      <TabsContent value="history" className="p-4 rounded-card border border-border bg-shell text-xs space-y-2">
        <h4 className="font-semibold text-foreground">Commit & Run History</h4>
        <p className="text-secondary-text">Review historical ledger benchmarks and compare parameter drifts.</p>
      </TabsContent>
      <TabsContent value="settings" className="p-4 rounded-card border border-border bg-shell text-xs space-y-2">
        <h4 className="font-semibold text-foreground">Project Preferences</h4>
        <p className="text-secondary-text">Export bundles, theme tokens, and simulation step budget caps.</p>
      </TabsContent>
    </Tabs>
  ),
};
