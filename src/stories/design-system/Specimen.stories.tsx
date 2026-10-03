import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen } from '@/components/studio/specimen/Specimen';

const meta: Meta<typeof Specimen> = {
  title: 'Design System/Living Specimen',
  component: Specimen,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

export const Default: StoryObj<typeof Specimen> = {
  name: 'Complete Design Specimen',
  render: () => (
    <div className="p-8 max-w-6xl mx-auto bg-background min-h-screen">
      <Specimen />
    </div>
  ),
};
