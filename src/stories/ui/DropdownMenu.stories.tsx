import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { within, userEvent, expect } from 'storybook/test';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  MoreHorizontal,
  Copy,
  Trash2,
  GitBranch,
  Settings,
  Share2,
  FileCode,
  FileSpreadsheet,
} from 'lucide-react';

const meta: Meta = {
  title: 'UI/DropdownMenu',
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj = {
  name: 'Triggered (Click to Open)',
  render: () => {
    const [showGrid, setShowGrid] = React.useState(true);

    return (
      <div className="p-8">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <MoreHorizontal className="size-4" />
              Node Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start">
            <DropdownMenuLabel>Placement #node-104</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Copy className="size-3.5 mr-2" />
                Duplicate
                <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <GitBranch className="size-3.5 mr-2" />
                Branch Scenario
                <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Share2 className="size-3.5 mr-2" />
                Export Model
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuItem>
                  <FileCode className="size-3.5 mr-2" />
                  JSON Manifest
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <FileSpreadsheet className="size-3.5 mr-2" />
                  CSV Trace Data
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
              Show Grid Guides
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive">
              <Trash2 className="size-3.5 mr-2" />
              Delete Node
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  },
};

export const OpenMenu: StoryObj = {
  name: 'Open Preview',
  render: () => {
    const [showGrid, setShowGrid] = React.useState(true);

    return (
      <div className="p-8">
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <MoreHorizontal className="size-4" />
              Node Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start">
            <DropdownMenuLabel>Placement #node-104</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Copy className="size-3.5 mr-2" />
                Duplicate
                <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <GitBranch className="size-3.5 mr-2" />
                Branch Scenario
                <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Share2 className="size-3.5 mr-2" />
                Export Model
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuItem>
                  <FileCode className="size-3.5 mr-2" />
                  JSON Manifest
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <FileSpreadsheet className="size-3.5 mr-2" />
                  CSV Trace Data
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
              Show Grid Guides
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive">
              <Trash2 className="size-3.5 mr-2" />
              Delete Node
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  },
};

export const PlayInteractionTest: StoryObj = {
  name: 'Menu Trigger & Select (Play Test)',
  render: () => (
    <div className="p-8">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-testid="menu-play-trigger">
            Actions Menu
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52">
          <DropdownMenuLabel>Node Actions</DropdownMenuLabel>
          <DropdownMenuItem data-testid="menu-item-duplicate">
            <Copy className="size-3.5 mr-2" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="menu-item-delete" className="text-destructive focus:text-destructive">
            <Trash2 className="size-3.5 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId('menu-play-trigger');
    await expect(trigger).toBeInTheDocument();

    // Click trigger to open menu
    await userEvent.click(trigger);

    // Menu portal mounts in document.body
    const body = within(document.body);
    const dupItem = await body.findByTestId('menu-item-duplicate');
    await expect(dupItem).toBeInTheDocument();

    // Click item
    await userEvent.click(dupItem);
  },
};
