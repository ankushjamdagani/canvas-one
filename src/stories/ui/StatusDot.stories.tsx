import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { StatusDot } from '@/components/ui/status-dot';

const meta: Meta<typeof StatusDot> = {
  title: 'UI/StatusDot',
  component: StatusDot,
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: ['live', 'degraded', 'idle', 'branch'],
      description: 'The status state tone',
    },
    halo: {
      control: 'boolean',
      description: 'Whether to show the ambient halo ring',
    },
  },
  args: {
    status: 'live',
    label: 'Cluster Healthy',
    halo: false,
  },
};

export default meta;
type Story = StoryObj<typeof StatusDot>;

export const Default: Story = {
  args: {
    status: 'live',
    label: 'Online',
  },
};

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-6">
      <StatusDot status="live" label="Live (Healthy)" />
      <StatusDot status="degraded" label="Degraded (High P99)" />
      <StatusDot status="idle" label="Idle / Offline" />
      <StatusDot status="branch" label="Branch Forked" />
    </div>
  ),
};

export const WithHaloGlow: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-6 p-4 rounded-card border border-border bg-shell">
      <StatusDot status="live" label="Live + Halo" halo />
      <StatusDot status="degraded" label="Degraded + Halo" halo />
      <StatusDot status="branch" label="Branch + Halo" halo />
    </div>
  ),
};
