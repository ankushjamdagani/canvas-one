import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { ProjectedNodeData } from './projection';

export function NoteNode({ data, selected }: NodeProps) {
  const nodeData = data as ProjectedNodeData;
  if (nodeData.kind !== 'note') return null;

  const isPaper = nodeData.tone === 'paper';

  return (
    <div
      data-testid={`note-${nodeData.note.id}`}
      className={cn(
        'note-card rounded-card p-3 border shadow-raised select-none transition-colors text-xs leading-relaxed',
        isPaper
          ? 'bg-note border-note-edge text-foreground'
          : 'bg-panel border-control-border text-body',
        selected && 'ring-2 ring-selected-edge ring-offset-1 border-primary',
      )}
      style={{
        width: nodeData.width,
      }}
    >
      <div className="whitespace-pre-wrap font-sans text-xs">
        {nodeData.text}
      </div>
    </div>
  );
}
