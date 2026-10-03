import type { Meta, StoryObj } from '@storybook/react-vite';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';

const meta: Meta<typeof NativeSelect> = {
  title: 'UI/NativeSelect',
  component: NativeSelect,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof NativeSelect> = {
  render: () => (
    <div className="space-y-1.5 max-w-xs">
      <Label htmlFor="region-select">Deployment Region</Label>
      <NativeSelect id="region-select" defaultValue="us-east-1">
        <NativeSelectOption value="us-east-1">US East (N. Virginia)</NativeSelectOption>
        <NativeSelectOption value="us-west-2">US West (Oregon)</NativeSelectOption>
        <NativeSelectOption value="eu-central-1">Europe (Frankfurt)</NativeSelectOption>
        <NativeSelectOption value="ap-southeast-1">Asia Pacific (Singapore)</NativeSelectOption>
      </NativeSelect>
    </div>
  ),
};

export const Disabled: StoryObj<typeof NativeSelect> = {
  render: () => (
    <div className="space-y-1.5 max-w-xs">
      <Label>Isolated Tenant</Label>
      <NativeSelect disabled defaultValue="tenant-dedicated">
        <NativeSelectOption value="tenant-dedicated">Dedicated Single Tenant</NativeSelectOption>
      </NativeSelect>
    </div>
  ),
};
