import type { Meta, StoryObj } from '@storybook/react-vite';
import { CanvasOneFace, FACE_EXPRESSIONS } from '@/components/ui/canvas-one-face';

const meta = {
  title: 'UI/Canvas One face', component: CanvasOneFace,
  args: { expression: 'base', size: 48, animate: true, tone: 'ink' },
  argTypes: { expression: { control: 'select', options: Object.keys(FACE_EXPRESSIONS) } },
} satisfies Meta<typeof CanvasOneFace>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
export const Expressions: StoryObj<typeof meta> = { render: () => <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-6">{Object.entries(FACE_EXPRESSIONS).map(([expression,label]) => <div key={expression} className="flex flex-col items-center gap-3 p-5"><CanvasOneFace expression={expression as keyof typeof FACE_EXPRESSIONS} size={56} /><span className="text-xs">{label}</span></div>)}</div> };
export const AppIcon: StoryObj<typeof meta> = { render: () => <div className="flex size-32 items-center justify-center rounded-[29px] bg-primary"><CanvasOneFace tone="icon" size={80} animate={false} /></div> };
