import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';

const meta: Meta<typeof RadioGroup> = {
  title: 'UI/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof RadioGroup> = {
  render: () => (
    <RadioGroup defaultValue="exponential" className="space-y-2 max-w-sm">
      <div className="flex items-center gap-2.5">
        <RadioGroupItem value="exponential" id="r-exp" />
        <Label htmlFor="r-exp">Exponential Service Time</Label>
      </div>
      <div className="flex items-center gap-2.5">
        <RadioGroupItem value="lognormal" id="r-log" />
        <Label htmlFor="r-log">Lognormal (Heavy Tail p95)</Label>
      </div>
      <div className="flex items-center gap-2.5">
        <RadioGroupItem value="constant" id="r-const" />
        <Label htmlFor="r-const">Constant Deterministic</Label>
      </div>
      <div className="flex items-center gap-2.5 opacity-50">
        <RadioGroupItem value="empirical" id="r-emp" disabled />
        <Label htmlFor="r-emp">Empirical Trace (Pro plan)</Label>
      </div>
    </RadioGroup>
  ),
};
