import type { ReactNode } from 'react';
import { ChevronsDownUp, ChevronsUpDown, ExternalLink } from 'lucide-react';
import { cn } from '@canvas-one/ui/utils';
import type { Element, Placement } from '../studio/model.js';
import { describeCalleeContract, describeCallerPolicy } from '../studio/port-settings.js';
import { describeEndpoint, portPath } from '../studio/protocols.js';
import { getNodeCaption, getNodeIcon } from './nodeVisuals.js';

export type LinkedProjectPresentation =
  | { readonly state: 'available'; readonly title: string; readonly team: string; readonly description: string }
  | { readonly state: 'loading' | 'unavailable' };

export type SystemDesignNodeCardProps = {
  readonly element: Element;
  readonly placement: Pick<Placement, 'id' | 'width' | 'expanded'>;
  readonly layer?: string | null;
  readonly stripeColor?: string | null;
  readonly selected?: boolean;
  readonly trafficEntry?: boolean;
  readonly highlighted?: boolean;
  readonly linked?: LinkedProjectPresentation;
  readonly onToggleExpanded?: () => void;
  readonly onOpenLinked?: () => void;
  readonly targetHandle?: ReactNode;
  readonly sourceHandle?: ReactNode;
  readonly activity?: ReactNode;
};

export function SystemDesignNodeCard({ element, placement, layer, stripeColor, selected, trafficEntry,
  highlighted, linked, onToggleExpanded, onOpenLinked, targetHandle, sourceHandle, activity }: SystemDesignNodeCardProps) {
  // placement.width stays authoritative (nominal card is about 184px;
  // wider placements render as authored rather than truncating fields).
  const Icon = getNodeIcon(element.visualKind);
  const caption = getNodeCaption(element);
  const portSummary = ['in', 'out']
    .map((direction) => {
      // Connectable ports read as their protocol and path (HTTP / REST /orders); event ports keep their label.
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
  // The linked project's live title wins; the element label is the fallback until it loads.
  const linkedTitle = linked?.state === 'available' ? linked.title : element.label;

  return (
    <div
      data-testid={`node-${placement.id}`}
      data-placement-id={placement.id}
      data-element-id={element.id}
      className={cn(
        highlighted && 'ring-2 ring-primary ring-offset-2',
        'component-node relative block rounded-node border bg-background transition-all select-none',
        selected
          ? 'selected border-2 border-ring ring-2 ring-selected-edge ring-offset-1 shadow-none'
          : 'border-control-border hover:border-hover-border hover:shadow-lifted',
      )}
      style={{
        width: placement.width,
      }}
    >
      {trafficEntry ? (
        <span
          data-testid={`node-traffic-entry-${element.id}`}
          className="absolute left-0 -top-6 whitespace-nowrap rounded-tag border border-ring/40 bg-selected-tint px-1.5 py-0.5 font-mono text-micro text-accent-foreground"
        >
          Traffic enters here
        </span>
      ) : null}
      {/* Node kind stripe by catalog layer (state-machine,
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

      {targetHandle}

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
          {onToggleExpanded && (
            <button
              type="button"
              data-testid={`node-expand-toggle-${element.id}`}
              aria-label={placement.expanded ? `Collapse ${element.label} ports` : `Expand ${element.label} ports`}
              title={placement.expanded ? 'Collapse ports' : 'Expand ports'}
              className="nodrag nopan pointer-events-auto shrink-0 inline-flex size-5 items-center justify-center rounded-xs text-secondary-text hover:text-foreground hover:bg-sunken transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded?.();
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
                className="shrink-0 rounded-tag border border-control-border bg-sunken px-1 font-mono text-micro tracking-wider text-secondary-text"
              >
                Linked
              </span>
              {linked.state === 'available' && linked.team ? (
                <span className="truncate font-mono text-micro text-secondary-text leading-snug">{linked.team}</span>
              ) : null}
            </div>
            {linked.state === 'available' ? (
              <>
                {linked.description ? (
                  <span className="line-clamp-2 text-caption leading-snug text-secondary-text">{linked.description}</span>
                ) : null}
              </>
            ) : (
              <span className="font-mono text-micro text-risk-text leading-snug">
                {linked.state === 'loading' ? 'Loading project…' : 'Project unavailable'}
              </span>
            )}
            <button
              type="button"
              data-testid={`node-linked-open-${element.id}`}
              disabled={!onOpenLinked}
              className="nodrag nopan pointer-events-auto mt-0.5 inline-flex w-fit items-center gap-1 rounded-control border border-control-border bg-background px-2 py-0.5 text-caption font-medium text-primary hover:bg-sunken disabled:cursor-not-allowed disabled:text-secondary-text disabled:opacity-60 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLinked?.();
              }}
            >
              <ExternalLink className="size-3" aria-hidden="true" />
              Open project
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5">
          {/* No truncate: caption values ("processor · 2 000 /s cap")
              can run long, so this wraps
              rather than clipping (the card has no fixed height). */}
          <span
            className="text-micro font-mono text-secondary-text leading-snug break-words"
            data-testid={`node-caption-${element.id}`}
          >
            {caption}
          </span>
        </div>

        {/* Placement.expanded adds a port summary under the caption.
            Fresh placements are expanded:false, so the default card is unchanged. */}
        {placement.expanded ? (
          <div
            data-testid={`node-ports-${element.id}`}
            aria-label="Port summary"
            className="mt-0.5 pt-1 border-t border-control-border text-micro font-mono text-secondary-text leading-snug break-words"
          >
            {portSummary}
          </div>
        ) : null}
      </div>

      {activity}
      {sourceHandle}
    </div>
  );
}
