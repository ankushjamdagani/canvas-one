import type { Meta, StoryObj } from '@storybook/react-vite';
import { Label } from '@/components/ui/label';

const meta: Meta<typeof Label> = {
  title: 'UI/Label',
  component: Label,
  tags: ['autodocs'],
  args: {
    children: 'Cluster Name',
  },
};

export default meta;

export const Default: StoryObj<typeof Label> = {
  render: (args) => <Label {...args} />,
};

export const FormContext: StoryObj<typeof Label> = {
  render: () => (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Standard Field Label</Label>
        <p className="text-xs text-secondary-text">Supporting descriptive caption</p>
      </div>
      <div className="space-y-1">
        <Label className="flex items-center gap-1">
          Required Field <span className="text-risk-text font-bold">*</span>
        </Label>
        <p className="text-xs text-secondary-text">Must be configured before running</p>
      </div>
    </div>
  ),
};
