import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverBody,
  PopoverFooter,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SlidersHorizontal, Settings2 } from 'lucide-react';

const meta: Meta = {
  title: 'UI/Popover',
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj = {
  name: 'Triggered (Click to Open)',
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="size-3.5" />
          Network Latency Profile
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <PopoverHeader>
          <span>Latency Jitter Model</span>
          <Settings2 className="size-3.5" />
        </PopoverHeader>
        <PopoverBody className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="base-latency">Base Latency (ms)</Label>
            <Input id="base-latency" defaultValue="12" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="std-dev">Standard Deviation</Label>
            <Input id="std-dev" defaultValue="3.5" />
          </div>
        </PopoverBody>
        <PopoverFooter className="flex justify-end gap-2 p-2.5">
          <Button size="sm" variant="ghost">Reset</Button>
          <Button size="sm" variant="default">Apply</Button>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  ),
};

export const OpenPopover: StoryObj = {
  name: 'Open Preview',
  render: () => (
    <div className="p-8">
      <Popover defaultOpen>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <SlidersHorizontal className="size-3.5" />
            Network Latency Profile
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <PopoverHeader>
            <span>Latency Jitter Model</span>
            <Settings2 className="size-3.5" />
          </PopoverHeader>
          <PopoverBody className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="open-base-latency">Base Latency (ms)</Label>
              <Input id="open-base-latency" defaultValue="12" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="open-std-dev">Standard Deviation</Label>
              <Input id="open-std-dev" defaultValue="3.5" />
            </div>
          </PopoverBody>
          <PopoverFooter className="flex justify-end gap-2 p-2.5">
            <Button size="sm" variant="ghost">Reset</Button>
            <Button size="sm" variant="default">Apply</Button>
          </PopoverFooter>
        </PopoverContent>
      </Popover>
    </div>
  ),
};
