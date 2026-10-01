import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const meta: Meta<typeof Checkbox> = {
  title: 'UI/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof Checkbox> = {
  render: () => {
    const [checked, setChecked] = React.useState<boolean | 'indeterminate'>(false);
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id="terms"
          checked={checked}
          onCheckedChange={(val) => setChecked(val)}
        />
        <Label htmlFor="terms">Enable Poisson distribution arrivals</Label>
      </div>
    );
  },
};

export const AllStates: StoryObj<typeof Checkbox> = {
  render: () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox id="c1" checked={false} />
        <Label htmlFor="c1">Unchecked</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="c2" checked={true} />
        <Label htmlFor="c2">Checked</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="c3" checked="indeterminate" />
        <Label htmlFor="c3">Indeterminate (Mixed parent)</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="c4" disabled checked={false} />
        <Label htmlFor="c4" className="opacity-60">Disabled unchecked</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="c5" disabled checked={true} />
        <Label htmlFor="c5" className="opacity-60">Disabled checked</Label>
      </div>
    </div>
  ),
};
