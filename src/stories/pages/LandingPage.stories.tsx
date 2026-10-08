import type { Meta, StoryObj } from '@storybook/react-vite';
import { LandingPage } from '@/features/entry/LandingPage';
const meta = { title: 'Pages/Landing', component: LandingPage, parameters: {layout: 'fullscreen'} } satisfies Meta<typeof LandingPage>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
