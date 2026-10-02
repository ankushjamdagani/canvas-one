import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import { Trash2, Pin, PinOff, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectedNodeData } from './projection';

export function NoteNode({ data, selected }: NodeProps) {
  const nodeData = data as ProjectedNodeData;
  if (nodeData.kind !== 'note') return null;

  const [isEditing, setIsEditing] = React.useState(
    () => nodeData.text === 'New note' || nodeData.text === '',
  );
  const [editText, setEditText] = React.useState(nodeData.text);
  const [linkMenuOpen, setLinkMenuOpen] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    setEditText(nodeData.text);
  }, [nodeData.text]);

  React.useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const commitEdit = React.useCallback(() => {
    setIsEditing(false);
    const trimmed = editText.trim();
    if (trimmed && trimmed !== nodeData.text) {
      nodeData.onUpdateText?.(trimmed);
    } else {
      setEditText(nodeData.text);
    }
  }, [editText, nodeData]);

  const isPaper = nodeData.tone === 'paper';
  const isAttached = (nodeData.note.attachedElementIds?.length ?? 0) > 0;

  return (
    <div
      data-testid={`note-${nodeData.note.id}`}
      onDoubleClick={() => setIsEditing(true)}
      className={cn(
        'group note-card rounded-card p-2.5 border shadow-raised select-none transition-all text-xs leading-relaxed relative',
        isPaper
          ? 'bg-note border-note-edge text-foreground'
          : 'bg-panel border-control-border text-body',
        selected && 'ring-2 ring-selected-edge ring-offset-1 border-primary',
      )}
      style={{
        width: nodeData.width,
      }}
    >
      {/* Top action bar: visible on hover or when selected */}
      <div className="flex items-center justify-between gap-1 mb-1 opacity-70 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-1 min-w-0">
          {isAttached ? (
            <span
              data-testid={`note-attached-indicator-${nodeData.note.id}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-tag bg-primary/10 border border-primary/20 text-primary font-mono text-[9px] font-medium max-w-[170px]"
              title={`Sticky linked to ${nodeData.attachedElementLabel || 'component node'}`}
            >
              <Pin className="size-2.5 rotate-45 shrink-0" />
              <span className="truncate">
                {nodeData.attachedElementLabel ? `Sticky: ${nodeData.attachedElementLabel}` : 'Sticky'}
              </span>
              {nodeData.onAttach && (
                <button
                  type="button"
                  data-testid={`note-detach-btn-${nodeData.note.id}`}
                  aria-label="Detach note"
                  title="Detach from component"
                  onClick={(e) => {
                    e.stopPropagation();
                    nodeData.onAttach?.(null);
                  }}
                  className="hover:text-destructive cursor-pointer ml-0.5 shrink-0"
                >
                  <PinOff className="size-2.5" />
                </button>
              )}
            </span>
          ) : nodeData.onAttach && nodeData.availableElements && nodeData.availableElements.length > 0 ? (
            <div className="relative">
              <button
                type="button"
                data-testid={`note-link-btn-${nodeData.note.id}`}
                aria-label="Link to component"
                title="Link note to a component"
                onClick={(e) => {
                  e.stopPropagation();
                  setLinkMenuOpen((prev) => !prev);
                }}
                className="nodrag nopan pointer-events-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-secondary-text hover:text-foreground hover:bg-black/5 cursor-pointer"
              >
                <Pin className="size-2.5" />
                <span>Link to node</span>
              </button>
              {linkMenuOpen && (
                <div
                  data-testid={`note-link-menu-${nodeData.note.id}`}
                  className="absolute left-0 top-full mt-1 z-modal w-44 rounded-card border border-control-border bg-panel shadow-floating p-1 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2 py-1 text-[10px] font-mono text-secondary-text uppercase">
                    Link to component
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-0.5">
                    {nodeData.availableElements.map((el) => (
                      <button
                        key={el.id}
                        type="button"
                        data-testid={`note-link-option-${el.id}`}
                        onClick={() => {
                          setLinkMenuOpen(false);
                          nodeData.onAttach?.(el.id);
                        }}
                        className="w-full text-left px-2 py-1 rounded text-xs hover:bg-selected-tint hover:text-primary transition-colors cursor-pointer truncate"
                      >
                        {el.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="font-mono text-[9px] uppercase tracking-wider text-secondary-text">
              Note
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 ml-auto">
          {!isEditing && (
            <button
              type="button"
              data-testid={`note-edit-btn-${nodeData.note.id}`}
              aria-label="Edit note"
              title="Edit note"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              className="nodrag nopan pointer-events-auto size-5 flex items-center justify-center rounded hover:bg-black/5 text-secondary-text hover:text-foreground cursor-pointer"
            >
              <Pencil className="size-2.5" />
            </button>
          )}
          {nodeData.onDelete && (
            <button
              type="button"
              data-testid={`note-delete-btn-${nodeData.note.id}`}
              aria-label="Delete note"
              title="Delete note"
              onClick={(e) => {
                e.stopPropagation();
                nodeData.onDelete?.();
              }}
              className="nodrag nopan pointer-events-auto size-5 flex items-center justify-center rounded hover:bg-destructive/15 text-secondary-text hover:text-destructive cursor-pointer"
            >
              <Trash2 className="size-2.5" />
            </button>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="nodrag nopan pointer-events-auto">
          <textarea
            ref={textareaRef}
            data-testid="dock-note-input"
            data-note-id={nodeData.note.id}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                setEditText(nodeData.text);
                setIsEditing(false);
              }
            }}
            className="w-full bg-background/80 rounded border border-primary p-1.5 text-xs text-foreground font-sans outline-none resize-none leading-relaxed"
            rows={Math.max(2, editText.split('\n').length)}
          />
          <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-secondary-text">
            <span>↵ save · Esc cancel</span>
          </div>
        </div>
      ) : (
        <div
          data-testid={`note-text-${nodeData.note.id}`}
          className="whitespace-pre-wrap font-sans text-xs select-none"
        >
          {nodeData.text}
        </div>
      )}
    </div>
  );
}

