import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Plus, History } from 'lucide-react';

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof EmptyState> = {
  render: () => (
    <div className="max-w-md p-6 bg-shell rounded-card">
      <EmptyState
        glyph="⊞"
        title="No components placed yet"
        detail="Open the library (P) or drop an architectural template onto the canvas to begin diagramming."
      >
        <Button size="sm" variant="default">
          <Plus className="size-3.5" />
          Browse Library
        </Button>
      </EmptyState>
    </div>
  ),
};

export const HistoryEmpty: StoryObj<typeof EmptyState> = {
  render: () => (
    <div className="max-w-md p-6 bg-shell rounded-card">
      <EmptyState
        glyph={<History className="size-6 text-secondary-text" />}
        title="No execution runs recorded"
        detail="Run a simulation scenario against this architecture graph to generate latency and throughput benchmarks."
      >
        <Button size="sm" variant="outline">
          Run Scenario
        </Button>
      </EmptyState>
    </div>
  ),
};
