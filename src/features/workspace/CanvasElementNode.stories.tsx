import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ReactFlow, ReactFlowProvider } from '@canvas-one/editor-reactflow/react';
import '@canvas-one/editor-reactflow/style.css';
import { CANVAS_ELEMENT_KINDS, type CanvasElement } from '../../domain/studio/model';
import { CanvasElementNode } from './CanvasElementNode';
import type { ProjectedNodeData } from './projection';

const nodeTypes = { canvasElementNode: CanvasElementNode };
function Fixture({ rejectSave = false }: { rejectSave?: boolean }) {
  const [items, setItems] = React.useState<CanvasElement[]>(() => CANVAS_ELEMENT_KINDS.map((kind, index) => ({ id: kind, kind, x: 40 + index % 3 * 250, y: 80 + Math.floor(index / 3) * 210, width: 180, height: 120, text: kind === 'text' ? 'Standalone text' : '', fill: kind === 'text' || kind === 'arrow' || kind === 'line' ? 'transparent' : '#ffffff', stroke: '#525252', strokeWidth: 2, fontSize: 16 })));
  const nodes = items.map(item => ({ id: item.id, type: 'canvasElementNode', position: { x: item.x, y: item.y }, style: { width: item.width, height: item.height }, selected: item.kind === 'text', data: { kind: 'canvas-element', canvasElement: item, onUpdate: async (patch: Partial<Omit<CanvasElement, 'id'>>) => { if (rejectSave) return false; setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, ...patch } : entry)); return true; } } satisfies ProjectedNodeData }));
  return <div style={{ width: 800, height: 750 }}><ReactFlowProvider><ReactFlow nodes={nodes} nodeTypes={nodeTypes} fitView /></ReactFlowProvider></div>;
}

const meta = { title: 'Workspace/Canvas elements', component: Fixture, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Primitives: Story = {};
export const EditText: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: 'Edit element text' }));
  const input = canvas.getByRole('textbox', { name: 'Element text' });
  await userEvent.clear(input);
  await userEvent.type(input, 'Request lifecycle');
  await userEvent.click(canvas.getByRole('button', { name: /^Save$/ }));
  await expect(canvas.getByText('Request lifecycle')).toBeVisible();
} };
export const SaveFailure: Story = { args: { rejectSave: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: 'Edit element text' }));
  const input = canvas.getByRole('textbox', { name: 'Element text' });
  await userEvent.clear(input);
  await userEvent.type(input, 'Keep this draft');
  await userEvent.click(canvas.getByRole('button', { name: /^Save$/ }));
  await expect(canvas.getByRole('alert')).toHaveTextContent('Could not save this change. Try again.');
  await expect(input).toHaveValue('Keep this draft');
} };
