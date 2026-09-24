import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { ProjectedNodeData } from './projection';

export function GroupNode({ data }: NodeProps) {
  const nodeData = data as ProjectedNodeData;
  if (nodeData.kind !== 'group') return null;

  return (
    <div
      data-testid={`group-${nodeData.group.id}`}
      className="group-boundary relative rounded-card border-2 border-dashed border-control-border bg-panel/30 pointer-events-none select-none"
      style={{
        width: nodeData.width,
        height: nodeData.height,
      }}
    >
      <div className="absolute top-1.5 left-2 px-2 py-0.5 rounded-tag bg-panel border border-control-border text-[11px] font-medium text-body shadow-xs">
        {nodeData.label}
      </div>
    </div>
  );
}
