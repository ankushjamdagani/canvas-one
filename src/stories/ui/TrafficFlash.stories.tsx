import type { Meta, StoryObj } from "@storybook/react-vite";
import { TrafficFlash } from "../../components/ui/traffic-flash";

const meta = {
  title: "UI/TrafficFlash",
  component: TrafficFlash,
} satisfies Meta<typeof TrafficFlash>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Lifecycle: Story = {
  args: { kind: "sent", outcome: null, count: 12, age: 0.5, reduced: false },
  render: (args) => (
    <svg width={420} height={90} viewBox="-15 -20 420 90">
      <TrafficFlash {...args} />
      <g transform="translate(60 0)">
        <TrafficFlash {...args} kind="arrived" />
      </g>
      {(
        [
          "ok",
          "rejected",
          "failed",
          "expired",
          "timed-out",
          "lost",
          "stuck",
        ] as const
      ).map((outcome, index) => (
        <g key={outcome} transform={`translate(${index * 55} 40)`}>
          <TrafficFlash {...args} kind="outcome" outcome={outcome} reduced />
        </g>
      ))}
    </svg>
  ),
};
