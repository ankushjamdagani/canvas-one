import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const meta: Meta<typeof Switch> = {
  title: 'UI/Switch',
  component: Switch,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof Switch> = {
  render: () => {
    const [enabled, setEnabled] = React.useState(true);
    return (
      <div className="flex items-center gap-2.5">
        <Switch id="retry-switch" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="retry-switch">Automatic Caller Retries (exponential backoff)</Label>
      </div>
    );
  },
};

export const States: StoryObj<typeof Switch> = {
  render: () => (
    <div className="space-y-4 max-w-sm">
      <div className="flex items-center justify-between">
        <Label htmlFor="s1">Deterministic Seed Randomness</Label>
        <Switch id="s1" defaultChecked />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="s2">FIFO Queue Reservation</Label>
        <Switch id="s2" defaultChecked={false} />
      </div>
      <div className="flex items-center justify-between opacity-60">
        <Label htmlFor="s3">Strict Mode (Locked)</Label>
        <Switch id="s3" disabled defaultChecked />
      </div>
    </div>
  ),
};
