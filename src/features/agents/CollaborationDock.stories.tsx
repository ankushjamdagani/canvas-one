import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { CollaborationDock, type CollaborationDockView } from './CollaborationDock';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

function InspectorFixture() {
  const [draft, setDraft] = React.useState('Checkout');
  const id = React.useId();
  return <div className="space-y-2 p-3"><Label htmlFor={id}>Component name</Label><Input id={id} value={draft} onChange={event => setDraft(event.target.value)} /><p className="text-caption text-secondary-text">Draft fixture · not saved to a board</p></div>;
}
function Harness() {
  const [activeView, setView] = React.useState<CollaborationDockView>('ai');
  const [count, setCount] = React.useState(1);
  const [open, setOpen] = React.useState(true);
  const opener = React.useRef<HTMLButtonElement>(null);
  return <div className="w-[320px] max-w-full space-y-2">
    <p className="text-caption text-secondary-text">Presentation fixture · no board edits</p>
    <Button ref={opener} type="button" onClick={() => setOpen(true)}>Open details</Button>
    <Button type="button" variant="outline" onClick={() => setCount(value => value + 1)}>Change selection count</Button>
    <div hidden={!open} className="h-[500px] border border-hairline"><CollaborationDock activeView={activeView} onViewChange={setView} inspectorCount={count} onClose={() => { setOpen(false); opener.current?.focus(); }} aiContent={<div className="p-3 text-caption">The conversation stays mounted while you inspect a component.</div>} inspectorContent={<InspectorFixture />} /></div>
  </div>;
}
const meta: Meta<typeof CollaborationDock> = { title: 'AI Collaboration/Shared details dock', component: CollaborationDock, parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;
export const DraftAndSelection: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Inspector (1)' }));
    const input = canvas.getByRole('textbox', { name: 'Component name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Checkout draft');
    await userEvent.click(canvas.getByRole('tab', { name: 'AI' }));
    await expect(input).not.toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Change selection count' }));
    await expect(canvas.getByRole('tab', { name: 'AI' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(canvas.getByRole('tab', { name: 'Inspector (2)' }));
    await expect(input).toHaveValue('Checkout draft');
  },
};
export const KeyboardAndClose: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const aiTab = canvas.getByRole('tab', { name: 'AI' });
    aiTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('tab', { name: 'Inspector (1)' })).toHaveFocus();
    await userEvent.click(canvas.getByRole('button', { name: 'Close details panel' }));
    await expect(canvas.getByRole('button', { name: 'Open details' })).toHaveFocus();
    await expect(canvas.getByTestId('collaboration-dock')).not.toBeVisible();
  },
};
