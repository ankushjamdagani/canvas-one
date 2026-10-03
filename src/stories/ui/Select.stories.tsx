import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const meta: Meta<typeof Select> = {
  title: 'UI/Select',
  component: Select,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj<typeof Select> = {
  render: () => (
    <div className="space-y-1.5 max-w-xs">
      <Label htmlFor="strategy-select">Traffic Distribution Strategy</Label>
      <Select defaultValue="round-robin">
        <SelectTrigger id="strategy-select">
          <SelectValue placeholder="Select strategy" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Stateless Balancing</SelectLabel>
            <SelectItem value="round-robin">Round Robin</SelectItem>
            <SelectItem value="least-conn">Least Connections</SelectItem>
            <SelectItem value="weighted">Weighted Random</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Stateful Balancing</SelectLabel>
            <SelectItem value="ip-hash">Consistent IP Hash</SelectItem>
            <SelectItem value="session">Sticky Session Cookie</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const Disabled: StoryObj<typeof Select> = {
  render: () => (
    <div className="space-y-1.5 max-w-xs opacity-60">
      <Label>Execution Engine (Locked)</Label>
      <Select disabled defaultValue="v5">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="v5">studio-runner/5 (Deterministic)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};
