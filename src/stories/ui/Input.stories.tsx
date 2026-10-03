import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
  args: {
    placeholder: 'Enter node title...',
    disabled: false,
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: 'e.g. auth-service-primary',
  },
};

export const WithLabelAndStates: Story = {
  render: () => (
    <div className="space-y-4 max-w-sm">
      <div className="space-y-1.5">
        <Label htmlFor="node-name">Node Identifier</Label>
        <Input id="node-name" placeholder="payment-gateway" defaultValue="gateway-us-east-1" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="max-qps">Max Capacity (QPS)</Label>
        <Input id="max-qps" type="number" defaultValue="2500" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="invalid-field">Invalid Field (aria-invalid)</Label>
        <Input id="invalid-field" aria-invalid="true" defaultValue="invalid port format" />
        <p className="text-[11px] text-risk-text">Port number must be an integer between 1 and 65535.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="disabled-input">Disabled Field</Label>
        <Input id="disabled-input" disabled defaultValue="System locked cluster" />
      </div>
    </div>
  ),
};
