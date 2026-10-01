import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Toggle } from '@/components/ui/toggle';
import { Bold, Italic, Underline, Grid, Pin, Sparkles } from 'lucide-react';

const meta: Meta<typeof Toggle> = {
  title: 'UI/Toggle',
  component: Toggle,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof Toggle> = {
  render: () => {
    const [pressed, setPressed] = React.useState(false);
    return (
      <Toggle pressed={pressed} onPressedChange={setPressed} aria-label="Toggle grid snapping">
        <Grid className="size-4" />
        Snap to Grid
      </Toggle>
    );
  },
};

export const Variants: StoryObj<typeof Toggle> = {
  render: () => (
    <div className="flex items-center gap-3">
      <Toggle variant="default" defaultPressed aria-label="Toggle pin">
        <Pin className="size-4" />
      </Toggle>
      <Toggle variant="outline" aria-label="Toggle sparkles">
        <Sparkles className="size-4" />
        AI Assistant
      </Toggle>
      <Toggle variant="segmented" defaultPressed aria-label="Toggle bold">
        <Bold className="size-4" />
      </Toggle>
    </div>
  ),
};
