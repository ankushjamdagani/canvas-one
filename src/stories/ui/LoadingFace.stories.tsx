import type { Meta, StoryObj } from '@storybook/react-vite';
import { LoadingFace } from '@/components/ui/loading-face';

const meta = {
  title: 'UI/Loading face',
  component: LoadingFace,
  args: { className: 'min-h-[320px] w-full bg-shell text-ink' },
} satisfies Meta<typeof LoadingFace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
