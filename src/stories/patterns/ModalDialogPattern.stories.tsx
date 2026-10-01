import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { within, userEvent, expect } from 'storybook/test';

const meta: Meta = {
  title: 'Patterns/Modal Dialog Form',
  parameters: {
    layout: 'centered',
  },
};

export default meta;

export const DefaultPattern: StoryObj = {
  name: 'Standard Modal Form Recipe',
  render: () => {
    return (
      <Dialog defaultOpen>
        <DialogTrigger asChild>
          <Button variant="default">Configure Service Cluster</Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="accent">CLUSTER CONFIG</Badge>
              <Badge variant="neutral">US-EAST-1</Badge>
            </div>
            <DialogTitle>Configure Service Cluster</DialogTitle>
            <DialogDescription>
              Adjust discrete-event concurrency, thread pool limits, and queue overflow behaviors.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4 py-2" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-1.5">
              <Label htmlFor="cluster-name">Cluster Name</Label>
              <Input id="cluster-name" defaultValue="Checkout-Order-Processing" placeholder="e.g. AuthGateway" />
              <p className="text-[11px] text-secondary-text">Unique identifier within this simulation model graph.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="worker-pool">Worker Concurrency</Label>
                <Input id="worker-pool" type="number" defaultValue="32" min="1" max="512" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="scheduling">Scheduling Queue</Label>
                <NativeSelect id="scheduling" defaultValue="fifo">
                  <option value="fifo">Strict FIFO</option>
                  <option value="lifo">LIFO Buffer</option>
                  <option value="priority">Priority Weighted</option>
                </NativeSelect>
              </div>
            </div>
          </form>

          <DialogFooter>
            <Button variant="secondary">Cancel</Button>
            <Button variant="default">Apply Configuration</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
};

export const InteractiveDialogTest: StoryObj = {
  name: 'Interactive Open & Fill (Play Test)',
  render: () => {
    const [open, setOpen] = React.useState(false);
    return (
      <div className="p-8">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="default" data-testid="open-dialog-btn">
              Open Configuration Modal
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Service Details</DialogTitle>
              <DialogDescription>Enter the service parameters below.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label htmlFor="test-svc-name">Service Identifier</Label>
                <Input id="test-svc-name" data-testid="service-input" placeholder="Enter identifier" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)} data-testid="cancel-btn">
                Cancel
              </Button>
              <Button variant="default" onClick={() => setOpen(false)} data-testid="save-btn">
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openBtn = canvas.getByTestId('open-dialog-btn');
    await expect(openBtn).toBeInTheDocument();

    // Click open
    await userEvent.click(openBtn);

    // Dialog portal renders in document.body
    const body = within(document.body);
    const input = await body.findByTestId('service-input');
    await expect(input).toBeInTheDocument();

    // Type into input
    await userEvent.type(input, 'PaymentGateway');
    await expect(input).toHaveValue('PaymentGateway');

    // Click Save
    const saveBtn = body.getByTestId('save-btn');
    await userEvent.click(saveBtn);
  },
};
