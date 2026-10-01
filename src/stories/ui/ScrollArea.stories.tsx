import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

const meta: Meta = {
  title: 'UI/ScrollArea',
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj = {
  render: () => {
    const events = Array.from({ length: 30 }).map((_, i) => ({
      id: i + 1,
      time: `+${(i * 12.5).toFixed(1)}ms`,
      caller: i % 2 === 0 ? 'gateway-primary' : 'auth-service',
      status: i % 7 === 0 ? 'RETRY' : '200 OK',
    }));

    return (
      <ScrollArea className="h-64 w-80 rounded-card border border-control-border bg-shell p-3">
        <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-secondary-text font-semibold">
          Discrete Simulation Events
        </h4>
        <div className="space-y-1 text-xs">
          {events.map((e) => (
            <React.Fragment key={e.id}>
              <div className="flex items-center justify-between py-1 font-mono text-[11px]">
                <span className="text-secondary-text">{e.time}</span>
                <span className="text-foreground">{e.caller}</span>
                <span className={e.status === 'RETRY' ? 'text-risk-text font-bold' : 'text-primary'}>
                  {e.status}
                </span>
              </div>
              <Separator />
            </React.Fragment>
          ))}
        </div>
      </ScrollArea>
    );
  },
};
