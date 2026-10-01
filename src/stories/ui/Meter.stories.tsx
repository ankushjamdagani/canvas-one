import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Meter } from '@/components/ui/meter';

const meta: Meta<typeof Meter> = {
  title: 'UI/Meter',
  component: Meter,
  tags: ['autodocs'],
  argTypes: {
    percent: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
    },
    tone: {
      control: 'select',
      options: ['green', 'clay'],
    },
  },
  args: {
    label: 'CPU LOAD',
    percent: 64,
    readout: '64%',
    tone: 'green',
  },
};

export default meta;
type Story = StoryObj<typeof Meter>;

export const Default: Story = {};

export const SystemMeters: Story = {
  render: () => (
    <div className="space-y-3 max-w-sm p-4 rounded-card border border-control-border bg-shell">
      <Meter label="MEMORY" percent={42} readout="4.2 / 10 GB" tone="green" />
      <Meter label="QUEUE WELL" percent={78} readout="7,820 / 10k" tone="green" />
      <Meter label="SATURATION" percent={94} readout="94% (RISK)" tone="clay" />
      <Meter label="ERROR RATE" percent={8} readout="0.08%" tone="green" />
    </div>
  ),
};
