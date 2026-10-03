import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, ShieldAlert, GitBranch } from 'lucide-react';

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'neutral',
        'success',
        'accent',
        'branch',
        'risk',
        'warning',
        'solid',
        'count',
        'outline',
      ],
      description: 'The tone/variant of the badge',
    },
  },
  args: {
    variant: 'neutral',
    children: 'v1.4.2',
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: {
    variant: 'neutral',
    children: 'READY',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2.5">
      <Badge variant="neutral">Neutral</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="accent">Accent</Badge>
      <Badge variant="branch">Branch</Badge>
      <Badge variant="risk">Risk / Degraded</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="solid">Solid</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="count">42</Badge>
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2.5">
      <Badge variant="success">
        <CheckCircle2 className="size-3" />
        Healthy
      </Badge>
      <Badge variant="warning">
        <AlertTriangle className="size-3" />
        High Latency
      </Badge>
      <Badge variant="risk">
        <ShieldAlert className="size-3" />
        P99 Saturated
      </Badge>
      <Badge variant="branch">
        <GitBranch className="size-3" />
        feature/sharding
      </Badge>
    </div>
  ),
};
