import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodeOccupancy } from "@/components/ui/node-occupancy";

const meta = {
  title: "Design System/Node occupancy",
  component: NodeOccupancy,
  decorators: [
    (Story) => (
      <div className="w-48 rounded-node border border-control-border bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NodeOccupancy>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Idle: Story = { args: { queued: 0, active: 0 } };
export const Processing: Story = { args: { queued: 0, active: 4 } };
export const Backlog: Story = { args: { queued: 412, active: 16 } };
