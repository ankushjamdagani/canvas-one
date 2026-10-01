import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, ArrowRight, Download, Settings, Play } from 'lucide-react';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'tint', 'ghost', 'link'],
      description: 'The visual variant of the button',
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
      description: 'The size dimension of the button',
    },
    loading: {
      control: 'boolean',
      description: 'Whether to show the loading spinner',
    },
    disabled: {
      control: 'boolean',
      description: 'Whether the button is disabled',
    },
  },
  args: {
    variant: 'default',
    size: 'default',
    loading: false,
    disabled: false,
    children: 'Action Button',
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: {
    variant: 'default',
    children: 'Primary Action',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="tint">Tint</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small (sm)</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large (lg)</Button>
      <Button size="icon" aria-label="Add item">
        <Plus className="size-4" />
      </Button>
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">
        <Play className="size-3.5 fill-current" />
        Run Scenario
      </Button>
      <Button variant="secondary">
        <Download className="size-3.5" />
        Export
      </Button>
      <Button variant="outline">
        Settings
        <ArrowRight className="size-3.5" />
      </Button>
      <Button variant="destructive">
        <Trash2 className="size-3.5" />
        Delete Node
      </Button>
    </div>
  ),
};

export const LoadingState: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button loading variant="default">
        Saving Simulation
      </Button>
      <Button loading variant="secondary">
        Exporting PDF
      </Button>
      <Button loading variant="outline" size="icon" aria-label="Loading action" />
    </div>
  ),
};

export const DisabledState: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled variant="default">Disabled Primary</Button>
      <Button disabled variant="secondary">Disabled Secondary</Button>
      <Button disabled variant="outline">Disabled Outline</Button>
      <Button disabled variant="tint">Disabled Tint</Button>
      <Button disabled variant="ghost">Disabled Ghost</Button>
      <Button disabled variant="destructive">Disabled Destructive</Button>
    </div>
  ),
};
