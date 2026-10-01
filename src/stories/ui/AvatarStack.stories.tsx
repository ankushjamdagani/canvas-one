import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { AvatarStack } from '@/components/ui/avatar-stack';

const meta: Meta<typeof AvatarStack> = {
  title: 'UI/AvatarStack',
  component: AvatarStack,
  tags: ['autodocs'],
  args: {
    people: ['AJ', 'MK', 'DL'],
    overflow: 3,
    label: '6 architects active',
  },
};

export default meta;
type Story = StoryObj<typeof AvatarStack>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="space-y-4">
      <AvatarStack people={['AJ', 'SL']} label="2 editors" />
      <AvatarStack people={['TC', 'RK', 'MN', 'OP']} overflow={8} label="12 viewers" />
      <AvatarStack people={['SA']} />
    </div>
  ),
};
