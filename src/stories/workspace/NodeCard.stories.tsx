import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReactFlowProvider } from '@canvas-one/editor-reactflow/react';
import { NodeCard } from '@/features/workspace/NodeCard';
import { nodeKindColor } from '@/components/studio/tokens';

const meta: Meta<typeof NodeCard> = {
  title: 'Workspace/NodeCard',
  component: NodeCard,
  tags: ['autodocs'],
};

export default meta;

export const Default: StoryObj = {
  render: () => {
    const mockNodeData = {
      kind: 'element' as const,
      element: {
        id: 'node-1',
        label: 'Authentication Microservice',
        description: 'Handles auth tokens and user sessions',
        visualKind: 'service',
        behavior: { kind: 'unmodeled' as const },
        ports: [
          { id: 'p1', direction: 'in' as const, channel: 'direct' as const, label: 'http' },
          { id: 'p2', direction: 'out' as const, channel: 'direct' as const, label: 'db' },
          { id: 'p3', direction: 'out' as const, channel: 'direct' as const, label: 'events' },
        ],
        attributes: {},
      },
      layer: 'compute' as const,
      stripeColor: nodeKindColor.compute,
      placement: {
        id: 'placement-1',
        elementId: 'node-1',
        x: 100,
        y: 100,
        width: 220,
        height: 100,
      },
      connectable: true,
      trafficEntry: false,
    };

    return (
      <ReactFlowProvider>
        <div className="p-8 flex flex-wrap gap-8 items-start bg-canvas">
          <div className="space-y-2">
            <span className="font-mono text-xs text-secondary-text">Default State</span>
            <NodeCard
              id="node-1"
              data={mockNodeData as any}
              selected={false}
              type="element"
              zIndex={1}
              isConnectable={true}
              positionAbsoluteX={0}
              positionAbsoluteY={0}
              dragging={false}
              draggable={false}
              selectable={false}
              deletable={false}
            />
          </div>

          <div className="space-y-2">
            <span className="font-mono text-xs text-secondary-text">Selected State</span>
            <NodeCard
              id="node-2"
              data={mockNodeData as any}
              selected={true}
              type="element"
              zIndex={1}
              isConnectable={true}
              positionAbsoluteX={0}
              positionAbsoluteY={0}
              dragging={false}
              draggable={false}
              selectable={false}
              deletable={false}
            />
          </div>

          <div className="space-y-2">
            <span className="font-mono text-xs text-secondary-text">Traffic Entry Point</span>
            <NodeCard
              id="node-3"
              data={
                {
                  ...mockNodeData,
                  trafficEntry: true,
                  layer: 'edge',
                  stripeColor: nodeKindColor.edge,
                  element: {
                    ...mockNodeData.element,
                    label: 'API Gateway Ingress',
                    visualKind: 'gateway',
                  },
                } as any
              }
              selected={false}
              type="element"
              zIndex={1}
              isConnectable={true}
              positionAbsoluteX={0}
              positionAbsoluteY={0}
              dragging={false}
              draggable={false}
              selectable={false}
              deletable={false}
            />
          </div>
        </div>
      </ReactFlowProvider>
    );
  },
};
