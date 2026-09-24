import * as React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { ProjectedNodeData } from './projection';

export function NodeCard({ data, selected }: NodeProps) {
  const nodeData = data as ProjectedNodeData;
  if (nodeData.kind !== 'element') return null;

  const { element, layer, stripeColor, placement } = nodeData;

  return (
    <div
      data-testid={`node-${placement.id}`}
      data-placement-id={placement.id}
      data-element-id={element.id}
      className={cn(
        'component-node relative block rounded-node border bg-panel transition-colors select-none',
        'shadow-raised',
        selected
          ? 'selected border-2 border-primary ring-2 ring-selected-edge ring-offset-1 shadow-none'
          : 'border-control-border hover:border-hover-border',
      )}
      style={{
        width: placement.width,
      }}
    >
      {/* RV-04c D35 node kind stripe by catalog layer */}
      {/* CONTRACT GAP: 'state-machine', 'data-pipeline', and 'host' are not assigned a layer in D35;
          they render with no kind stripe (neutral). */}
      {stripeColor ? (
        <div
          className="node-category-strip absolute inset-x-0 top-0 h-[3px] rounded-t-node"
          style={{ backgroundColor: stripeColor }}
          aria-hidden="true"
          data-node-layer={layer ?? undefined}
        />
      ) : null}

      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!size-1 !bg-control-border !border-none !pointer-events-none opacity-40"
      />

      <div className="p-2.5 pt-3 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <strong
            className="text-xs font-semibold text-ink truncate leading-tight"
            title={element.label}
          >
            {element.label}
          </strong>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-mono text-secondary-text truncate"
            data-testid={`node-caption-${element.id}`}
          >
            {element.visualKind}
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!size-1 !bg-control-border !border-none !pointer-events-none opacity-40"
      />
    </div>
  );
}
