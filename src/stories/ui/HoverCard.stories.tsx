import type { Meta, StoryObj } from '@storybook/react-vite';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Badge } from '@/components/ui/badge';
import { StatusDot } from '@/components/ui/status-dot';

const meta: Meta = {
  title: 'UI/HoverCard',
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="p-8">
      <HoverCard>
        <HoverCardTrigger asChild>
          <a
            href="#inspect"
            className="font-mono text-xs font-semibold text-primary underline underline-offset-4 cursor-pointer"
          >
            postgres-primary-01
          </a>
        </HoverCardTrigger>
        <HoverCardContent className="w-80 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold">PostgreSQL Relational DB</h4>
            <StatusDot status="live" label="Sync" />
          </div>
          <p className="text-xs text-secondary-text leading-relaxed">
            Primary write replica with synchronous replication to us-east-1b. Max connection pool: 120 slots.
          </p>
          <div className="flex items-center gap-2 pt-1 border-t border-hairline">
            <Badge variant="neutral">layer: data</Badge>
            <span className="font-mono text-[10.5px] text-body">p95: 4.2ms</span>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  ),
};
