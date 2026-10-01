import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Progress } from '@/components/ui/progress';

const meta: Meta<typeof Progress> = {
  title: 'UI/Progress',
  component: Progress,
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
    },
  },
  args: {
    value: 65,
  },
};

export default meta;

export const Determinate: StoryObj<typeof Progress> = {
  render: () => {
    const [progress, setProgress] = React.useState(15);

    React.useEffect(() => {
      const timer = setInterval(() => {
        setProgress((prev) => (prev >= 100 ? 0 : prev + 10));
      }, 800);
      return () => clearInterval(timer);
    }, []);

    return (
      <div className="space-y-2 max-w-md">
        <div className="flex justify-between text-xs">
          <span>Simulating 10,000 events</span>
          <span className="font-mono font-medium">{progress}%</span>
        </div>
        <Progress value={progress} />
      </div>
    );
  },
};

export const Indeterminate: StoryObj<typeof Progress> = {
  render: () => (
    <div className="space-y-2 max-w-md">
      <div className="text-xs text-secondary-text">Compiling execution graph...</div>
      <Progress data-state="indeterminate" />
    </div>
  ),
};
