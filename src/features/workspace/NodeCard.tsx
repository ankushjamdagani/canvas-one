import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useContext } from 'react';
import { PlaybackTrafficContext } from './usePlaybackTraffic';
import { NodeOccupancy } from '@/components/ui/node-occupancy';
import { TrafficFlash } from '@/components/ui/traffic-flash';
import { ChevronsDownUp, ChevronsUpDown, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectedNodeData } from './projection';
import { describeCalleeContract, describeCallerPolicy } from '../../domain/studio/port-settings';
import { describeEndpoint, portPath } from '../../domain/studio/protocols';
import { getNodeCaption, getNodeIcon } from './nodeVisuals';

export function NodeCard({ data, selected }: NodeProps) {
  const traffic = useContext(PlaybackTrafficContext);
  const nodeData = data as ProjectedNodeData;
  if (nodeData.kind !== 'element') return null;

  const { element, layer, stripeColor, placement, connectable, trafficEntry } = nodeData;
  // placement.width stays authoritative (2A workspace: ~184px nominal card,
  // wider placements render as authored rather than truncating fields).
  const Icon = getNodeIcon(element.visualKind);
  const caption = getNodeCaption(element);
  const portSummary = ['in', 'out']
    .map((direction) => {
      // D53: connectable ports read as their protocol and path (HTTP / REST /orders); event ports keep their label.
      const labels = element.ports
        .filter((p) => p.direction === direction)
        .map((p) => {
          const protocol = p.protocol;
          if (protocol === null) return p.label;
          const terms = p.direction === 'in' ? describeCalleeContract(p) : describeCallerPolicy(p);
          return terms ? `${describeEndpoint(protocol, portPath(p))} (${terms})` : describeEndpoint(protocol, portPath(p));
        });
      return `${direction}: ${labels.length > 0 ? labels.join(', ') : 'none'}`;
    })
    .join(' · ');
  const linked = nodeData.linked;
  // The linked project's live title wins; the element label is the fallback until it loads.
  const linkedTitle = linked?.state === 'available' ? linked.title : element.label;
  const hasOutPort = element.ports.some((p) => p.direction === 'out' && p.channel !== 'event');
  const hasInPort = element.ports.some((p) => p.direction === 'in' && p.channel !== 'event');

  return (
    <div
      data-testid={`node-${placement.id}`}
      data-placement-id={placement.id}
      data-element-id={element.id}
      className={cn(
        'component-node relative block rounded-node border bg-background transition-all select-none',
        selected
          ? 'selected border-2 border-primary ring-2 ring-selected-edge ring-offset-1 shadow-none'
          : 'border-control-border hover:border-hover-border hover:shadow-lifted',
      )}
      style={{
        width: placement.width,
      }}
    >
      {trafficEntry ? (
        <span
          data-testid={`node-traffic-entry-${element.id}`}
          className="absolute left-0 -top-6 whitespace-nowrap rounded-tag border border-primary/40 bg-selected-tint px-1.5 py-0.5 font-mono text-meta uppercase text-primary"
        >
          Traffic enters here
        </span>
      ) : null}
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
            className="text-xs font-semibold text-ink truncate leading-tight flex-1 min-w-0"
            title={linkedTitle}
          >
            {linkedTitle}
          </strong>
          {nodeData.onToggleExpanded && (
            <button
              type="button"
              data-testid={`node-expand-toggle-${element.id}`}
              aria-label={placement.expanded ? `Collapse ${element.label} ports` : `Expand ${element.label} ports`}
              title={placement.expanded ? 'Collapse ports' : 'Expand ports'}
              className="nodrag nopan pointer-events-auto shrink-0 inline-flex size-5 items-center justify-center rounded-xs text-secondary-text hover:text-foreground hover:bg-sunken transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                nodeData.onToggleExpanded?.();
              }}
            >
              {placement.expanded ? (
                <ChevronsDownUp className="size-3" />
              ) : (
                <ChevronsUpDown className="size-3" />
              )}
            </button>
          )}
        </div>

        {linked ? (
          <div data-testid={`node-linked-details-${element.id}`} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                data-testid={`node-linked-badge-${element.id}`}
                className="shrink-0 rounded-tag border border-control-border bg-sunken px-1 font-mono text-[9px] uppercase tracking-wider text-secondary-text"
              >
                Linked
              </span>
              {linked.state === 'available' && linked.team ? (
                <span className="truncate font-mono text-[10px] text-secondary-text leading-snug">{linked.team}</span>
              ) : null}
            </div>
            {linked.state === 'available' ? (
              <>
                {linked.description ? (
                  <span className="line-clamp-2 text-[11px] leading-snug text-secondary-text">{linked.description}</span>
                ) : null}
              </>
            ) : (
              <span className="font-mono text-[10px] text-risk-text leading-snug">
                {linked.state === 'loading' ? 'Loading project…' : 'Project unavailable'}
              </span>
            )}
            <button
              type="button"
              data-testid={`node-linked-open-${element.id}`}
              disabled={!nodeData.onOpenLinked}
              className="nodrag nopan pointer-events-auto mt-0.5 inline-flex w-fit items-center gap-1 rounded-control border border-control-border bg-background px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-sunken disabled:cursor-not-allowed disabled:text-secondary-text disabled:opacity-60 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                nodeData.onOpenLinked?.();
              }}
            >
              <ExternalLink className="size-3" aria-hidden="true" />
              Open project
            </button>
          </div>
        ) : null}

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
            aria-label="Port summary"
            className="mt-0.5 pt-1 border-t border-control-border text-[10px] font-mono text-secondary-text leading-snug break-words"
          >
            {portSummary}
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-full mt-1">
        <NodeOccupancy {...(traffic.nodes.get(element.id) ?? { queued: 0, active: 0 })} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 -top-7 flex gap-1">
        {(traffic.nodeFlashes.get(element.id) ?? []).map((flash) => (
          <svg key={`${flash.kind}:${flash.outcome}`} width={flash.count > 1 ? 38 + String(flash.count).length * 7 : 24} height={24}
            className="shrink-0 overflow-visible" viewBox={`-12 -12 ${flash.count > 1 ? 38 + String(flash.count).length * 7 : 24} 24`}>
            <TrafficFlash {...flash} reduced={traffic.reduced} />
          </svg>
        ))}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={Boolean(connectable) && hasOutPort}
        data-testid={`node-handle-source-${element.id}`}
        className={cn(
          connectable && hasOutPort
            ? '!bg-primary opacity-90'
            : '!bg-control-border opacity-40 !pointer-events-none',
        )}
      />
    </div>
  );
}
