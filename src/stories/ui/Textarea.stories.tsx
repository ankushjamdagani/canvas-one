import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const meta: Meta<typeof Textarea> = {
  title: 'UI/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  args: {
    placeholder: 'Write scenario notes or architectural hypotheses...',
    disabled: false,
  },
};

export default meta;

export const Default: StoryObj<typeof Textarea> = {
  args: {
    placeholder: 'Add description...',
  },
};

export const WithLabel: StoryObj<typeof Textarea> = {
  render: () => (
    <div className="space-y-4 max-w-md">
      <div className="space-y-1.5">
        <Label htmlFor="scenario-desc">Scenario Hypotheses</Label>
        <Textarea
          id="scenario-desc"
          rows={4}
          defaultValue="Under 5x normal traffic spike, the Redis cache hit ratio will remain above 85% to protect the PostgreSQL replicas."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="disabled-desc">Archived Run Notes</Label>
        <Textarea
          id="disabled-desc"
          rows={3}
          disabled
          defaultValue="Read-only run manifest from production baseline 2026-09-28."
        />
      </div>
    </div>
  ),
};
