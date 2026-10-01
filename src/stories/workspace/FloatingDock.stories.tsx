import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { FloatingDock } from '@/features/workspace/FloatingDock';
import { DEFAULT_DOCK_CONFIG, type DockConfig } from '@/features/workspace/dockConfig';
import type { CommandContext } from '@/features/workspace/commands/registry';

import { mockCommandContext } from './mockContext';

const meta: Meta<typeof FloatingDock> = {
  title: 'Workspace/FloatingDock',
  component: FloatingDock,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj = {
  render: () => {
    const [dragMode, setDragMode] = React.useState<'select' | 'pan'>('select');
    const [config, setConfig] = React.useState<DockConfig>(DEFAULT_DOCK_CONFIG);

    return (
      <div className="relative min-h-[160px] w-full bg-shell p-8 flex items-center justify-center border border-border rounded-card">
        <FloatingDock
          className="static bottom-auto left-auto translate-x-0"
          style={{ position: 'relative', bottom: 'auto', left: 'auto', transform: 'none' }}
          dragMode={dragMode}
          zoom={1}
          context={mockCommandContext}
          config={config}
          preferenceState="ready"
          onInvoke={(cmd) => {
            if (cmd === 'canvas.select-tool') setDragMode('select');
            if (cmd === 'canvas.pan-tool') setDragMode('pan');
          }}
          onConfigure={setConfig}
          onRestoreDefaults={() => setConfig(DEFAULT_DOCK_CONFIG)}
          onAddNote={async () => ({ ok: true })}
          onGroup={async () => ({ ok: true })}
          onPlaceEntry={() => {}}
        />
      </div>
    );
  },
};

export const Customizing: StoryObj = {
  render: () => {
    const [config, setConfig] = React.useState<DockConfig>(DEFAULT_DOCK_CONFIG);

    return (
      <div className="relative min-h-[360px] w-full bg-shell p-8 flex items-center justify-center border border-border rounded-card">
        <FloatingDock
          className="static bottom-auto left-auto translate-x-0"
          style={{ position: 'relative', bottom: 'auto', left: 'auto', transform: 'none' }}
          dragMode="select"
          zoom={1}
          context={mockCommandContext}
          config={config}
          preferenceState="ready"
          onInvoke={() => {}}
          onConfigure={setConfig}
          onRestoreDefaults={() => setConfig(DEFAULT_DOCK_CONFIG)}
          onAddNote={async () => ({ ok: true })}
          onGroup={async () => ({ ok: true })}
          onPlaceEntry={() => {}}
        />
      </div>
    );
  },
};
