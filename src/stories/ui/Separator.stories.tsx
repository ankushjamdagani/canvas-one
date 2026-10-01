import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Separator } from '@/components/ui/separator';

const meta: Meta<typeof Separator> = {
  title: 'UI/Separator',
  component: Separator,
  tags: ['autodocs'],
};

export default meta;

export const Horizontal: StoryObj<typeof Separator> = {
  render: () => (
    <div className="space-y-3 max-w-sm">
      <div className="space-y-1">
        <h4 className="text-xs font-semibold leading-none">System Topology</h4>
        <p className="text-xs text-secondary-text">Active multi-region deployment</p>
      </div>
      <Separator />
      <div className="flex h-5 items-center space-x-3 text-xs">
        <span>3 Regions</span>
        <Separator orientation="vertical" />
        <span>18 Services</span>
        <Separator orientation="vertical" />
        <span>0 Drops</span>
      </div>
    </div>
  ),
};
