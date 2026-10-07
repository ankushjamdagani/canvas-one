import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandMark } from "@/components/ui/brand-mark";

const meta = { title: "UI/Brand mark", component: BrandMark } satisfies Meta<typeof BrandMark>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
export const Large: StoryObj<typeof meta> = { args: { className: "size-10 rounded-[10px]" } };
