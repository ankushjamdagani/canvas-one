import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Search,
  Plus,
  Copy,
  Trash2,
  GitBranch,
  Play,
  RotateCcw,
  Sliders,
} from 'lucide-react';

const meta: Meta<typeof Command> = {
  title: 'UI/Command',
  component: Command,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof Command> = {
  render: () => (
    <div className="max-w-md shadow-popover">
      <Command className="rounded-popover border-border">
        <CommandInput placeholder="Type a command or search actions..." />
        <CommandList className="max-h-72">
          <CommandEmpty>No matching actions found.</CommandEmpty>
          <CommandGroup heading="Canvas Actions">
            <CommandItem>
              <Plus className="size-4 mr-2" />
              <span>Add Component to Canvas</span>
              <CommandShortcut>P</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <Copy className="size-4 mr-2" />
              <span>Duplicate Selected Subgraph</span>
              <CommandShortcut>⌘D</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Simulation Controls">
            <CommandItem>
              <Play className="size-4 mr-2" />
              <span>Execute Scenario S06</span>
              <CommandShortcut>↵</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <RotateCcw className="size-4 mr-2" />
              <span>Reset Scenario Clock</span>
              <CommandShortcut>R</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Branching">
            <CommandItem>
              <GitBranch className="size-4 mr-2" />
              <span>Create Branch from Current Graph</span>
              <CommandShortcut>⌘B</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  ),
};
