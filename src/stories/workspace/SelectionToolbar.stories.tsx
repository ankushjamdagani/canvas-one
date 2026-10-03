import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReactFlowProvider } from '@xyflow/react';
import { SelectionToolbar } from '@/features/workspace/SelectionToolbar';
import { mockCommandContext } from './mockContext';

const meta: Meta<typeof SelectionToolbar> = {
  title: 'Workspace/SelectionToolbar',
  component: SelectionToolbar,
  tags: ['autodocs'],
};

export default meta;

const selectedContext = {
  ...mockCommandContext,
  selectedElementIds: ['node-1', 'node-2'],
  selectedConnectionIds: ['edge-1'],
  selectionWhollyUngrouped: true,
};

export const Default: StoryObj = {
  render: () => (
    <ReactFlowProvider>
      <div className="relative min-h-[160px] w-full bg-shell p-8 flex items-center justify-center border border-border rounded-card">
        <SelectionToolbar
          className="static"
          style={{ position: 'relative', top: 'auto', right: 'auto' }}
          context={selectedContext}
          executeCommand={async () => ({ status: 'done', value: { ok: true } as any })}
          mintId={() => 'id-' + Math.random().toString(36).slice(2, 9)}
        />
      </div>
    </ReactFlowProvider>
  ),
};
