import { Handle, Position, type NodeProps } from '@canvas-one/editor-reactflow/react';
import { ChevronDown, ChevronRight, Ungroup } from 'lucide-react';
import type { ProjectedNodeData } from './projection';

export function GroupNode({ data }: NodeProps) {
  const nodeData = data as ProjectedNodeData;
  if (nodeData.kind !== 'group') return null;

  const { collapsed, label, memberCount, onToggleCollapsed, onUngroup, onSelectGroup } = nodeData;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const toggleLabel = `${collapsed ? 'Expand' : 'Collapse'} group ${label}`;
  const toggle = (
    <button
      type="button"
      data-testid={`group-toggle-${nodeData.group.id}`}
      aria-label={toggleLabel}
      aria-expanded={!collapsed}
      title={toggleLabel}
      disabled={!onToggleCollapsed}
      onClick={(event) => {
        event.stopPropagation();
        onToggleCollapsed?.();
      }}
      className="nodrag nopan pointer-events-auto shrink-0 inline-flex items-center justify-center size-8 pointer-coarse:size-11 -my-1.5 -ml-1.5 rounded-tag text-secondary-text hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50 cursor-pointer"
    >
      <Chevron className="size-3.5" aria-hidden="true" />
    </button>
  );

  const ungroupBtn = onUngroup ? (
    <button
      type="button"
      data-testid={`group-ungroup-${nodeData.group.id}`}
      aria-label={`Ungroup ${label}`}
      title={`Ungroup ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onUngroup();
      }}
      className="nodrag nopan pointer-events-auto shrink-0 inline-flex items-center justify-center size-6 rounded text-secondary-text hover:text-foreground hover:bg-black/5 cursor-pointer transition-colors"
    >
      <Ungroup className="size-3" aria-hidden="true" />
    </button>
  ) : null;

  if (collapsed) {
    return (
      <div
        data-testid={`group-${nodeData.group.id}`}
        data-collapsed="true"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          onSelectGroup?.();
        }}
        className="group-boundary relative flex items-center gap-1 pl-2 pr-2.5 rounded-node border-2 border-dashed border-control-border bg-panel shadow-raised select-none cursor-pointer"
        style={{ width: nodeData.width, height: nodeData.height }}
      >
        <Handle type="target" position={Position.Left} isConnectable={false} className="!size-2 !border-none !bg-control-border opacity-40 !pointer-events-none" />
        {toggle}
        <span className="min-w-0 truncate text-xs font-semibold text-ink" title={label}>{label}</span>
        <span
          data-testid={`group-count-${nodeData.group.id}`}
          className="ml-auto shrink-0 px-1.5 rounded-tag bg-sunken font-mono text-[10px] font-semibold text-secondary-text"
        >
          {memberCount} {memberCount === 1 ? 'part' : 'parts'}
        </span>
        {ungroupBtn}
        <Handle type="source" position={Position.Right} isConnectable={false} className="!size-2 !border-none !bg-control-border opacity-40 !pointer-events-none" />
      </div>
    );
  }

  return (
    <div
      data-testid={`group-${nodeData.group.id}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        onSelectGroup?.();
      }}
      className="group-boundary relative rounded-card border-2 border-dashed border-control-border bg-panel/30 hover:border-primary/50 select-none cursor-pointer pointer-events-auto"
      style={{
        width: nodeData.width,
        height: nodeData.height,
      }}
    >
      <div
        data-testid={`group-header-${nodeData.group.id}`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          onSelectGroup?.();
        }}
        className="absolute top-1.5 left-2 flex items-center gap-1 pl-1 pr-2 rounded-tag bg-panel border border-control-border text-[11px] font-medium text-body shadow-xs pointer-events-auto cursor-pointer"
      >
        {toggle}
        <span>{label}</span>
        {ungroupBtn}
      </div>
    </div>
  );
}
