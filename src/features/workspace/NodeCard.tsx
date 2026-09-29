import * as React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { ProjectedNodeData } from './projection';
import { getNodeCaption, getNodeIcon } from './nodeVisuals';

export function NodeCard({ data, selected }: NodeProps) {
  const nodeData = data as ProjectedNodeData;
  if (nodeData.kind !== 'element') return null;

  const { element, layer, stripeColor, placement, connectable } = nodeData;
  // placement.width stays authoritative (2A workspace: ~184px nominal card,
  // wider placements render as authored rather than truncating fields).
  const Icon = getNodeIcon(element.visualKind);
  const caption = getNodeCaption(element);
  const portSummary = ['in', 'out']
    .map((direction) => {
      const labels = element.ports.filter((p) => p.direction === direction).map((p) => p.label);
      return `${direction}: ${labels.length > 0 ? labels.join(', ') : 'none'}`;
    })
    .join(' · ');
  const hasOutPort = element.ports.some((p) => p.direction === 'out' && p.channel !== 'event');
  const hasInPort = element.ports.some((p) => p.direction === 'in' && p.channel !== 'event');

  return (
    <div
      data-testid={`node-${placement.id}`}
      data-placement-id={placement.id}
      data-element-id={element.id}
      className={cn(
        'component-node relative block rounded-node border bg-background transition-colors select-none',
        selected
          ? 'selected border-2 border-primary ring-2 ring-selected-edge ring-offset-1 shadow-none'
          : 'border-control-border hover:border-hover-border',
      )}
      style={{
        width: placement.width,
      }}
    >
      {/* Node kind stripe by catalog layer (D35, extended by D42: state-machine,
          data-pipeline and host each get their own stripe group; custom gets
          none — getCatalogLayer/CATALOG_LAYER_COLORS in projection.ts). */}
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
        isConnectable={Boolean(connectable) && hasInPort}
        data-testid={`node-handle-target-${element.id}`}
        className={cn(
          '!size-2 !border-none',
          connectable && hasInPort
            ? '!bg-primary opacity-90'
            : '!bg-control-border opacity-40 !pointer-events-none',
        )}
      />

      <div className="p-2.5 pt-3 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon
            size={13}
            className="shrink-0 text-secondary-text"
            aria-hidden="true"
          />
          <strong
            className="text-xs font-semibold text-ink truncate leading-tight"
            title={element.label}
          >
            {element.label}
          </strong>
        </div>

        <div className="flex items-center gap-1.5">
          {/* No truncate: D42's caption values ("processor · 2 000 /s cap")
              can run longer than the old bare visualKind text, so this wraps
              rather than clipping (the card has no fixed height). */}
          <span
            className="text-[10px] font-mono text-secondary-text leading-snug break-words"
            data-testid={`node-caption-${element.id}`}
          >
            {caption}
          </span>
        </div>

        {/* RV-04g: Placement.expanded adds a port summary under the caption.
            Fresh placements are expanded:false (catalog.md resolution 4), so
            the default card is unchanged. */}
        {placement.expanded ? (
          <div
            data-testid={`node-ports-${element.id}`}
            className="mt-0.5 pt-1 border-t border-control-border text-[10px] font-mono text-secondary-text leading-snug break-words"
          >
            {portSummary}
          </div>
        ) : null}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={Boolean(connectable) && hasOutPort}
        data-testid={`node-handle-source-${element.id}`}
        className={cn(
          '!size-2 !border-none',
          connectable && hasOutPort
            ? '!bg-primary opacity-90'
            : '!bg-control-border opacity-40 !pointer-events-none',
        )}
      />
    </div>
  );
}
