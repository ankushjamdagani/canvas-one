import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MousePointer, Hand, Maximize2, LayoutGrid, List } from 'lucide-react';

const meta: Meta<typeof ToggleGroup> = {
  title: 'UI/ToggleGroup',
  component: ToggleGroup,
  tags: ['autodocs'],
};

export default meta;

export const SingleSelect: StoryObj<typeof ToggleGroup> = {
  render: () => {
    const [mode, setMode] = React.useState('select');
    return (
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(val) => val && setMode(val)}
        aria-label="Canvas mode"
      >
        <ToggleGroupItem value="select" aria-label="Select mode">
          <MousePointer className="size-3.5" />
          Select
        </ToggleGroupItem>
        <ToggleGroupItem value="pan" aria-label="Pan tool">
          <Hand className="size-3.5" />
          Pan
        </ToggleGroupItem>
        <ToggleGroupItem value="fit" aria-label="Fit view">
          <Maximize2 className="size-3.5" />
          Fit
        </ToggleGroupItem>
      </ToggleGroup>
    );
  },
};

export const ViewMode: StoryObj<typeof ToggleGroup> = {
  render: () => (
    <ToggleGroup type="single" defaultValue="grid" aria-label="View format">
      <ToggleGroupItem value="grid" aria-label="Grid view">
        <LayoutGrid className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List view">
        <List className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};
