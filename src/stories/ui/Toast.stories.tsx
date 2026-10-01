import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
} from '@/components/ui/toast';
import { Button } from '@/components/ui/button';

const meta: Meta = {
  title: 'UI/Toast',
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj = {
  render: () => {
    const [open, setOpen] = React.useState(false);
    const [isDestructive, setIsDestructive] = React.useState(false);

    return (
      <ToastProvider swipeDirection="right">
        <div className="flex gap-3">
          <Button
            variant="default"
            onClick={() => {
              setIsDestructive(false);
              setOpen(true);
            }}
          >
            Show Success Toast
          </Button>

          <Button
            variant="destructive"
            onClick={() => {
              setIsDestructive(true);
              setOpen(true);
            }}
          >
            Show Error Toast
          </Button>
        </div>

        <Toast open={open} onOpenChange={setOpen} variant={isDestructive ? 'destructive' : 'default'}>
          <div className="grid gap-1">
            <ToastTitle>
              {isDestructive ? 'Simulation Halted' : 'Export Package Ready'}
            </ToastTitle>
            <ToastDescription>
              {isDestructive
                ? 'Circuit breaker tripped on service auth-svc due to 5 consecutive timeouts.'
                : 'Architecture model exported to system-studio-v9.json.'}
            </ToastDescription>
          </div>
          <ToastAction altText="Undo" asChild>
            <Button size="sm" variant={isDestructive ? 'outline' : 'secondary'}>
              {isDestructive ? 'Retry' : 'Download'}
            </Button>
          </ToastAction>
          <ToastClose />
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );
  },
};
