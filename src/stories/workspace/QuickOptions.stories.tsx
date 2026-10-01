import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { QuickOptionsContent, QuickOptionsDialog } from '@/features/workspace/QuickOptions';
import { buildQuickOptions } from '@/features/workspace/commands/registry';
import { Button } from '@/components/ui/button';
import { mockCommandContext } from './mockContext';

const meta: Meta<typeof QuickOptionsContent> = {
  title: 'Workspace/QuickOptions',
  component: QuickOptionsContent,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj = {
  name: 'Inline (Command Palette)',
  render: () => {
    const [mode, setMode] = React.useState<'list' | 'rename'>('list');
    const groups = buildQuickOptions(mockCommandContext);

    return (
      <div className="max-w-xl mx-auto border border-border rounded-popover shadow-popover bg-background overflow-hidden">
        <QuickOptionsContent
          groups={groups}
          projectTitle="Checkout System Architecture"
          branchLabel="main"
          isMac={true}
          mode={mode}
          onRun={(opt) => {
            if (opt.id === 'project.rename') setMode('rename');
          }}
          onRename={async () => ({ ok: true })}
          onTextCommand={async () => ({ ok: true })}
          onBack={() => setMode('list')}
        />
      </div>
    );
  },
};

export const ModalDialog: StoryObj = {
  name: 'Modal Dialog (Triggered)',
  render: () => {
    const [open, setOpen] = React.useState(false);
    const groups = buildQuickOptions(mockCommandContext);

    return (
      <div className="p-8 flex justify-center">
        <Button variant="default" onClick={() => setOpen(true)}>
          Open Quick Options (F2)
        </Button>
        <QuickOptionsDialog
          open={open}
          onOpenChange={setOpen}
          groups={groups}
          projectTitle="Checkout System Architecture"
          branchLabel="main"
          isMac={true}
          onRun={() => {}}
          onRename={async () => ({ ok: true })}
          onTextCommand={async () => ({ ok: true })}
        />
      </div>
    );
  },
};

export const ModalDialogOpen: StoryObj = {
  name: 'Modal Dialog (Open Preview)',
  render: () => {
    const [open, setOpen] = React.useState(true);
    const groups = buildQuickOptions(mockCommandContext);

    return (
      <div className="p-8 flex justify-center">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Reopen Quick Options
        </Button>
        <QuickOptionsDialog
          open={open}
          onOpenChange={setOpen}
          groups={groups}
          projectTitle="Checkout System Architecture"
          branchLabel="main"
          isMac={true}
          onRun={() => {}}
          onRename={async () => ({ ok: true })}
          onTextCommand={async () => ({ ok: true })}
        />
      </div>
    );
  },
};

