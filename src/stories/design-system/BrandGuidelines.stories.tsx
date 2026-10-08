import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandPage } from "@/features/entry/BrandPage";

const meta = {
  title: "Design System/Brand guidelines",
  component: BrandPage,
  parameters: { layout: "fullscreen" },
  args: { animate: true },
} satisfies Meta<typeof BrandPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Guide: Story = {};
export const Still: Story = { args: { animate: false } };
