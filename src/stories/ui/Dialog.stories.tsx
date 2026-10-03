import type { Meta, StoryObj } from '@storybook/react-vite';
import { within, userEvent, expect } from 'storybook/test';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const meta: Meta = {
  title: 'UI/Dialog',
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj = {
  name: 'Triggered (Click to Open)',
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="default">New Scenario</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Simulation Scenario</DialogTitle>
          <DialogDescription>
            Configure workload parameters, arrival patterns, and target quiescence limits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="scenario-title">Scenario Name</Label>
            <Input id="scenario-title" defaultValue="Black Friday Traffic Surge" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="traffic-peak">Peak Request Load (req/s)</Label>
            <Input id="traffic-peak" type="number" defaultValue="25000" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="default">Create Scenario</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const OpenDialog: StoryObj = {
  name: 'Open Preview',
  render: () => (
    <Dialog defaultOpen>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Simulation Scenario</DialogTitle>
          <DialogDescription>
            Configure workload parameters, arrival patterns, and target quiescence limits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="open-scenario-title">Scenario Name</Label>
            <Input id="open-scenario-title" defaultValue="Black Friday Traffic Surge" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="open-traffic-peak">Peak Request Load (req/s)</Label>
            <Input id="open-traffic-peak" type="number" defaultValue="25000" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="default">Create Scenario</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const PlayInteractionTest: StoryObj = {
  name: 'Keyboard & Click Interaction Test (Play)',
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="default" data-testid="dialog-play-trigger">
          Open Test Dialog
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Automated Play Test</DialogTitle>
          <DialogDescription>Verifying modal trigger, portal mounting, and keyboard dismissal.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Input data-testid="dialog-play-input" placeholder="Type here..." />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" data-testid="dialog-play-cancel">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId('dialog-play-trigger');
    await expect(trigger).toBeInTheDocument();

    // Click trigger to open
    await userEvent.click(trigger);

    // Find input in modal portal
    const body = within(document.body);
    const input = await body.findByTestId('dialog-play-input');
    await expect(input).toBeInTheDocument();

    // Type text
    await userEvent.type(input, 'Verified In Storybook');
    await expect(input).toHaveValue('Verified In Storybook');

    // Click Close
    const closeBtn = body.getByTestId('dialog-play-cancel');
    await userEvent.click(closeBtn);
  },
};
