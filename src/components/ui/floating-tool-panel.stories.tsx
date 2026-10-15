import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { FloatingToolPanel } from './floating-tool-panel';

const meta = { title: 'Foundation/Floating tool panel', component: FloatingToolPanel, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof FloatingToolPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
function Example() {
  const [open, setOpen] = React.useState(true), [minimized, setMinimized] = React.useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>Open panel</button><FloatingToolPanel title="AI collaboration" open={open} minimized={minimized} onMinimizedChange={setMinimized} onClose={() => setOpen(false)}><label>Saved draft<input aria-label="Saved draft" /></label></FloatingToolPanel></>;
}
export const Independent: Story = {
  args: { title: 'AI collaboration', open: true, minimized: false, onMinimizedChange: () => {}, onClose: () => {}, children: null }, render: () => <Example />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Saved draft' }), 'Keep this draft');
    const panel = canvas.getByRole('complementary', { name: 'AI collaboration floating panel' });
    const before = panel.getBoundingClientRect().x;
    const mover = canvas.getByRole('button', { name: 'Move AI collaboration panel' });
    mover.focus(); await userEvent.keyboard('{ArrowLeft}');
    await expect(panel.getBoundingClientRect().x).toBeLessThan(before);
    await userEvent.click(canvas.getByRole('button', { name: 'Minimize AI collaboration' }));
    await expect(canvas.queryByRole('textbox', { name: 'Saved draft' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Restore AI collaboration' }));
    await expect(canvas.getByRole('textbox', { name: 'Saved draft' })).toHaveValue('Keep this draft');
    await userEvent.click(canvas.getByRole('button', { name: 'Close AI collaboration' }));
    await expect(canvas.queryByRole('complementary', { name: 'AI collaboration floating panel' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Open panel' }));
    await expect(canvas.getByRole('textbox', { name: 'Saved draft' })).toHaveValue('Keep this draft');
  },
};
