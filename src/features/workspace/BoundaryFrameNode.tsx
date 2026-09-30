import * as React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronsDownUp } from 'lucide-react';
import type { ProjectedNodeData } from './projection';

export function BoundaryFrameNode({ data, selected }: NodeProps) {
  const nodeData = data as ProjectedNodeData;
  if (nodeData.kind !== 'boundary') return null;

  const inbound = nodeData.element.ports.filter((port) => port.direction === 'in');
  const outbound = nodeData.element.ports.filter((port) => port.direction === 'out');
  const handleTop = (index: number, count: number) => `${((index + 1) / (count + 1)) * 100}%`;
  const collapseLabel = `Collapse boundary ${nodeData.element.label}`;

  return (
    <div
      data-testid={`boundary-frame-${nodeData.element.id}`}
      data-placement-id={nodeData.placement.id}
      data-element-id={nodeData.element.id}
      className={`boundary-frame relative rounded-card bg-selected-tint/20 select-none ${selected ? 'border-2 border-primary ring-2 ring-selected-edge ring-offset-1' : 'border border-primary'}`}
      style={{ width: nodeData.width, height: nodeData.height }}
    >
      <div className="nodrag nopan pointer-events-auto absolute left-2 top-1 z-10 flex h-7 items-center gap-1.5 rounded-tag border border-primary/30 bg-panel px-2 text-[11px] font-semibold text-ink shadow-xs">
        <span className="max-w-52 truncate" title={nodeData.element.label}>{nodeData.element.label}</span>
        <button
          type="button"
          data-testid={`boundary-collapse-${nodeData.element.id}`}
          aria-label={collapseLabel}
          title={collapseLabel}
          disabled={!nodeData.onToggleCollapsed}
          onClick={(event) => {
            event.stopPropagation();
            nodeData.onToggleCollapsed?.();
          }}
          className="inline-flex size-7 pointer-coarse:size-11 items-center justify-center rounded-tag text-secondary-text hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50"
        >
          <ChevronsDownUp className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {inbound.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          isConnectable={false}
          data-testid={`boundary-port-${port.id}`}
          className="!size-2 !border-none !bg-primary"
          style={{ top: handleTop(index, inbound.length) }}
        />
      ))}
      {outbound.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          isConnectable={false}
          data-testid={`boundary-port-${port.id}`}
          className="!size-2 !border-none !bg-primary"
          style={{ top: handleTop(index, outbound.length) }}
        />
      ))}
    </div>
  );
}
