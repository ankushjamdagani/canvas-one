import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Stepper } from '@/components/ui/stepper';
import { Label } from '@/components/ui/label';

const meta: Meta<typeof Stepper> = {
  title: 'UI/Stepper',
  component: Stepper,
  tags: ['autodocs'],
  argTypes: {
    value: { control: 'number' },
    min: { control: 'number' },
    max: { control: 'number' },
    step: { control: 'number' },
    disabled: { control: 'boolean' },
  },
  args: {
    value: 4,
    min: 1,
    max: 32,
    step: 1,
    disabled: false,
  },
};

export default meta;
type Story = StoryObj<typeof Stepper>;

export const Default: Story = {
  render: () => {
    const [val, setVal] = React.useState(8);
    return (
      <div className="flex items-center gap-4">
        <Label>Worker Threads</Label>
        <Stepper value={val} min={1} max={64} onChange={setVal} />
      </div>
    );
  },
};

export const StepperGroup: Story = {
  render: () => {
    const [replicas, setReplicas] = React.useState(3);
    const [retries, setRetries] = React.useState(2);
    return (
      <div className="space-y-4 max-w-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Replica Count</span>
          <Stepper value={replicas} min={1} max={12} onChange={setReplicas} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Max Retries</span>
          <Stepper value={retries} min={0} max={5} onChange={setRetries} />
        </div>
        <div className="flex items-center justify-between opacity-60">
          <span className="text-xs font-medium">Fixed Nodes (Locked)</span>
          <Stepper value={1} disabled />
        </div>
      </div>
    );
  },
};
