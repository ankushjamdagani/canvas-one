import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@canvas-one/editor-reactflow/react';
import { useContext, useLayoutEffect } from 'react';
import { useSystemDesignNodeRenderer } from '@canvas-one/system-design/react';
import { PlaybackTrafficContext } from './usePlaybackTraffic';
import { SimulationHighlightContext } from './SimulationHighlight';
import { CellsAndLanesNode } from '@/components/traffic/cells-and-lanes';
import type { ProjectedNodeData } from './projection';

export function NodeCard({ id, data, selected }: NodeProps) {
  const Renderer = useSystemDesignNodeRenderer((data as ProjectedNodeData).kind === 'element' ? (data as Extract<ProjectedNodeData, {kind: 'element'}>).element.component?.type : undefined);
  const traffic = useContext(PlaybackTrafficContext);
  const highlight = useContext(SimulationHighlightContext);
  const node = data as ProjectedNodeData;
  const updateNodeInternals = useUpdateNodeInternals();
  const ports = node.kind === 'element' ? node.element.ports : undefined;
  const expanded = node.kind === 'element' ? node.placement.expanded : undefined;
  // Renderer/selection updates can replace handles without changing card size.
  // ResizeObserver alone then leaves visible handles out of the engine registry.
  useLayoutEffect(() => { updateNodeInternals(id); }, [id, Renderer, selected, ports, expanded, updateNodeInternals]);
  if (node.kind !== 'element') return null;
  const { element, connectable } = node;
  const activity = traffic.activities?.nodes.get(element.id);
  const title = node.linked?.state === 'available' ? node.linked.title : element.label;
  const handle = (direction: 'in' | 'out') => {
    const enabled = Boolean(connectable) && element.ports.some((p) => p.direction === direction && p.channel !== 'event');
    const type = direction === 'in' ? 'target' : 'source';
    return <Handle type={type} position={direction === 'in' ? Position.Left : Position.Right}
      isConnectable={enabled} data-testid={`node-handle-${type}-${element.id}`}
      className={enabled ? '!bg-primary opacity-90' : '!bg-control-border opacity-40 !pointer-events-none'} />;
  };
  return <Renderer {...node} selected={selected} highlighted={highlight?.elementIds.has(element.id)}
    targetHandle={handle('in')} sourceHandle={handle('out')}
    activity={activity ? <div className="pointer-events-none absolute inset-x-0 top-full mt-1">
      <CellsAndLanesNode label={title} activityOnly activity={activity} style={{ width: '100%', pointerEvents: 'auto' }} />
    </div> : undefined} />;
}
