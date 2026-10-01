import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { LibraryRow, type LibraryRowState } from '@/components/ui/library-row';
import { Badge } from '@/components/ui/badge';
import { Database, Server, Radio, Shield, Globe } from 'lucide-react';

const meta: Meta<typeof LibraryRow> = {
  title: 'UI/LibraryRow',
  component: LibraryRow,
  tags: ['autodocs'],
  argTypes: {
    state: {
      control: 'select',
      options: ['rest', 'hover', 'selected', 'dragging', 'disabled', 'loading'],
    },
  },
};

export default meta;

export const AllStates: StoryObj = {
  render: () => {
    const states: { state: LibraryRowState; title: string; meta: string; glyph: React.ReactNode }[] = [
      {
        state: 'rest',
        title: 'PostgreSQL Database',
        meta: 'layer: data · 1 in, 0 out',
        glyph: <Database className="size-4 text-emerald-600" />,
      },
      {
        state: 'hover',
        title: 'API Gateway',
        meta: 'layer: edge · 1 in, 4 out',
        glyph: <Globe className="size-4 text-amber-600" />,
      },
      {
        state: 'selected',
        title: 'Kafka Event Broker',
        meta: 'layer: messaging · 2 in, 2 out',
        glyph: <Radio className="size-4 text-purple" />,
      },
      {
        state: 'dragging',
        title: 'Auth Microservice',
        meta: 'layer: compute · 1 in, 2 out',
        glyph: <Server className="size-4 text-primary" />,
      },
      {
        state: 'disabled',
        title: 'Legacy RPC Stub',
        meta: 'deprecated in schema v9',
        glyph: <Shield className="size-4 text-secondary-text" />,
      },
      {
        state: 'loading',
        title: 'Loading Component...',
        meta: '',
        glyph: null,
      },
    ];

    return (
      <div className="space-y-2 max-w-sm">
        {states.map((item) => (
          <LibraryRow
            key={item.state}
            state={item.state}
            title={item.title}
            meta={item.meta}
            glyph={item.glyph}
            trailing={<Badge variant="neutral">{item.state}</Badge>}
          />
        ))}
      </div>
    );
  },
};
