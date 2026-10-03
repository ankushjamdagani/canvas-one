import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  DropdownMenuPanel,
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownHeader,
  DropdownBody,
  DropdownFooter,
  DropdownItem,
  DropdownShortcut,
  DropdownSeparator,
} from '@/components/ui/dropdown';
import { Button } from '@/components/ui/button';
import { Sliders, RefreshCw, FileText, Download, Trash2, Edit3, Copy, Settings } from 'lucide-react';

const meta: Meta<typeof DropdownMenuPanel> = {
  title: 'UI/DropdownMenuPanel',
  component: DropdownMenuPanel,
  tags: ['autodocs'],
};

export default meta;

export const DeclarativePanel: StoryObj<typeof DropdownMenuPanel> = {
  render: () => (
    <div className="p-8 flex justify-center">
      <DropdownMenuPanel
        heading="PROJECT"
        width={300}
        items={[
          {
            label: 'Rename project',
            icon: <Edit3 className="size-3.5" />,
            shortcut: '⌘R',
          },
          {
            label: 'Duplicate project',
            icon: <Copy className="size-3.5" />,
          },
          {
            label: 'Project settings',
            icon: <Settings className="size-3.5" />,
            shortcut: '⌘,',
          },
          { divider: true },
          {
            label: 'Delete project',
            danger: true,
            icon: <Trash2 className="size-3.5" />,
          },
        ]}
        footer={
          <div className="flex justify-between w-full text-[10px] text-secondary-text font-mono">
            <span>Esc close</span>
            <span>4 items</span>
          </div>
        }
      />
    </div>
  ),
};

export const TriggerDropdown: StoryObj = {
  render: () => (
    <div className="p-8">
      <Dropdown defaultOpen>
        <DropdownTrigger asChild>
          <Button variant="secondary" size="sm">
            <Sliders className="size-3.5" />
            Studio Menu
          </Button>
        </DropdownTrigger>
        <DropdownContent align="start" className="w-64 p-0">
          <DropdownHeader>
            <span>Simulation Commands</span>
          </DropdownHeader>
          <DropdownBody>
            <DropdownItem>
              <RefreshCw className="size-3.5 mr-2 text-secondary-text" />
              Reset Seed Sequence
              <DropdownShortcut>⌘R</DropdownShortcut>
            </DropdownItem>
            <DropdownItem>
              <FileText className="size-3.5 mr-2 text-secondary-text" />
              Generate Architecture Report
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem>
              <Download className="size-3.5 mr-2 text-secondary-text" />
              Download State Package
            </DropdownItem>
          </DropdownBody>
          <DropdownFooter>
            <span className="text-[10px] text-secondary-text font-mono">v9 system-studio</span>
          </DropdownFooter>
        </DropdownContent>
      </Dropdown>
    </div>
  ),
};
