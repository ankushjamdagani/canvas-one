import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { AgentCursor, agentPresenceLabel, type AgentPresence } from './AgentCursor';

function CursorFixture({ phase = 'reading', spatial = true }: { readonly phase?: AgentPresence['phase']; readonly spatial?: boolean }) {
  const presence: AgentPresence = { providerLabel: 'Claude', phase, targetIds: spatial ? ['checkout'] : [] };
  return <div className="w-[320px] max-w-full space-y-2">
    <p className="text-caption text-secondary-text">Presentation fixture · a factual tool target, no agent execution</p>
    <div className="relative h-64 overflow-hidden border border-hairline bg-canvas">
      <div className="absolute left-10 top-20 border border-control-border bg-panel px-3 py-2 text-caption">Checkout service</div>
      <AgentCursor presence={presence} position={spatial ? { x: 48, y: 88 } : undefined} />
      <p role="status" className="sr-only">{agentPresenceLabel(presence)}</p>
    </div>
  </div>;
}
const meta: Meta<typeof AgentCursor> = { title: 'AI Collaboration/Agent presence', component: AgentCursor, parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;
export const InspectingTarget: Story = {
  render: () => <CursorFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cursor = canvas.getByTestId('agent-presence-cursor');
    await expect(cursor).toHaveAttribute('aria-hidden', 'true');
    await expect(cursor).toHaveAttribute('data-spatial', 'target');
    await expect(getComputedStyle(cursor).pointerEvents).toBe('none');
    await expect(canvas.getByRole('status')).toHaveTextContent('Claude · Inspecting board');
  },
};
export const ApplyingChanges: Story = { render: () => <CursorFixture phase="applying" /> };
export const PreparingReview: Story = { render: () => <CursorFixture phase="reviewing" /> };
export const WholeBoardRead: Story = {
  render: () => <CursorFixture spatial={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('agent-presence-cursor')).not.toBeInTheDocument();
  },
};
