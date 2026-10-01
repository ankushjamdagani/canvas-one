import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Kbd, KbdGroup, KeyHint } from '@/components/ui/kbd';

const meta: Meta<typeof Kbd> = {
  title: 'UI/Kbd',
  component: Kbd,
  tags: ['autodocs'],
};

export default meta;

export const Keys: StoryObj = {
  render: () => (
    <div className="space-y-6 max-w-md">
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Single Keys</h4>
        <div className="flex items-center gap-2">
          <Kbd>⌘</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>⌥</Kbd>
          <Kbd>⌃</Kbd>
          <Kbd>F2</Kbd>
          <Kbd>Esc</Kbd>
          <Kbd>Del</Kbd>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Key Combinations (KbdGroup)</h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs py-1 border-b border-hairline">
            <span>Quick Options</span>
            <KbdGroup>
              <Kbd>F2</Kbd>
            </KbdGroup>
          </div>
          <div className="flex items-center justify-between text-xs py-1 border-b border-hairline">
            <span>Duplicate Selection</span>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>D</Kbd>
            </KbdGroup>
          </div>
          <div className="flex items-center justify-between text-xs py-1 border-b border-hairline">
            <span>Group Nodes</span>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>G</Kbd>
            </KbdGroup>
          </div>
          <div className="flex items-center justify-between text-xs py-1">
            <span>Fit Canvas View</span>
            <KbdGroup>
              <Kbd>⇧</Kbd>
              <Kbd>1</Kbd>
            </KbdGroup>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold">KeyHint (Tactile 3D Keycap)</h4>
        <div className="flex items-center gap-3">
          <KeyHint>⌘K</KeyHint>
          <KeyHint>Space</KeyHint>
          <KeyHint>Tab</KeyHint>
          <KeyHint>Enter ↵</KeyHint>
        </div>
      </div>
    </div>
  ),
};
