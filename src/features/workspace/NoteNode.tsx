import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import {
  Trash2, Pin, PinOff, Pencil, MessageSquare, Minimize2, Palette, Check,
  Bold, Italic, Strikethrough, Code, Link as LinkIcon, List,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { applyFormat, type FormatKind } from '@/lib/miniMarkdown';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NOTE_TONES } from '../../domain/studio/model';
import type { ProjectedNodeData } from './projection';
import { NoteMarkdown } from './NoteMarkdown';
import { NOTE_TONE_STYLES } from './noteTones';

const HOVER_CLOSE_DELAY_MS = 150;
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const FORMAT_ACTIONS: readonly { kind: FormatKind; label: string; shortcut?: string; Icon: typeof Bold }[] = [
  { kind: 'bold', label: 'Bold', shortcut: 'B', Icon: Bold },
  { kind: 'italic', label: 'Italic', shortcut: 'I', Icon: Italic },
  { kind: 'strike', label: 'Strikethrough', Icon: Strikethrough },
  { kind: 'code', label: 'Code', Icon: Code },
  { kind: 'link', label: 'Link', shortcut: 'K', Icon: LinkIcon },
  { kind: 'list', label: 'Bulleted list', Icon: List },
];

export function NoteNode({ data, selected }: NodeProps) {
  const nodeData = data as ProjectedNodeData;
  if (nodeData.kind !== 'note') return null;

  const [isEditing, setIsEditing] = React.useState(
    () => nodeData.text === 'New note' || nodeData.text === '',
  );
  const [editText, setEditText] = React.useState(nodeData.text);
  const [linkMenuOpen, setLinkMenuOpen] = React.useState(false);
  const [colorOpen, setColorOpen] = React.useState(false);
  // A note rests as a comment bubble; hover previews it and a click keeps it open.
  const [pinned, setPinned] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const leaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
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

  React.useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);

  const onEnter = React.useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHovered(true);
  }, []);
  const onLeave = React.useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setHovered(false), HOVER_CLOSE_DELAY_MS);
  }, []);

  const format = React.useCallback((kind: FormatKind) => {
    const area = textareaRef.current;
    if (!area) return;
    const next = applyFormat(editText, area.selectionStart, area.selectionEnd, kind);
    setEditText(next.text);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }, [editText]);

  const toneStyle = NOTE_TONE_STYLES[nodeData.tone];
  const open = pinned || hovered || isEditing || colorOpen || linkMenuOpen;
  const isAttached = (nodeData.note.attachedElementIds?.length ?? 0) > 0;

  if (!open) {
    return (
      <div
        data-testid={`note-${nodeData.note.id}`}
        data-open="false"
        data-pinned={pinned}
        // The root div (not the button) takes the pointer: opening swaps the button out, and a click
        // whose mousedown target left the DOM is never delivered. Keyboard users still use the button.
        className="size-8 cursor-pointer"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={() => setPinned(true)}
        onDoubleClick={() => {
        setPinned(true);
        setIsEditing(true);
      }}
      >
        <button
          type="button"
          data-testid={`note-bubble-${nodeData.note.id}`}
          aria-label="Open note"
          aria-expanded={false}
          title="Open note"
          className={cn(
            'pointer-events-none relative size-8 rounded-full border shadow-raised flex items-center justify-center text-secondary-text transition-colors',
            toneStyle.card,
            selected && 'ring-2 ring-ring ring-offset-1 border-ring',
          )}
        >
          <MessageSquare className="size-3.5" aria-hidden="true" />
          {isAttached && (
            <Pin
              data-testid={`note-attached-indicator-${nodeData.note.id}`}
              className="absolute -top-1 -right-1 size-3 rotate-45 text-primary"
              aria-label="Linked to a component"
            />
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid={`note-${nodeData.note.id}`}
      data-open="true"
      data-pinned={pinned}
      data-hovered={hovered}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={() => {
        if (!isEditing) setPinned(true);
      }}
      onDoubleClick={() => {
        setPinned(true);
        setIsEditing(true);
      }}
      className={cn(
        'group note-card rounded-card p-2.5 border shadow-raised select-none transition-all text-xs leading-relaxed relative text-foreground',
        toneStyle.card,
        selected && 'ring-2 ring-ring ring-offset-1 border-ring',
      )}
      style={{
        width: nodeData.width,
      }}
    >
      {/* Top action bar: visible on hover or when selected */}
      <div className="flex items-center justify-between gap-1 mb-1 opacity-100 group-hover:opacity-100 transition-opacity">
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
                        className="w-full text-left px-2 py-1 rounded text-xs hover:bg-selected-tint hover:text-accent-foreground transition-colors cursor-pointer truncate"
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
                setPinned(true);
                setIsEditing(true);
              }}
              className="nodrag nopan pointer-events-auto size-5 flex items-center justify-center rounded hover:bg-black/5 text-secondary-text hover:text-foreground cursor-pointer"
            >
              <Pencil className="size-2.5" />
            </button>
          )}
          {nodeData.onUpdateTone && (
            <Popover open={colorOpen} onOpenChange={setColorOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid={`note-color-btn-${nodeData.note.id}`}
                  aria-label="Note colour"
                  title="Note colour"
                  onClick={(e) => e.stopPropagation()}
                  className="nodrag nopan pointer-events-auto size-5 flex items-center justify-center rounded hover:bg-black/5 text-secondary-text hover:text-foreground cursor-pointer"
                >
                  <Palette className="size-2.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="end"
                sideOffset={4}
                data-testid={`note-color-menu-${nodeData.note.id}`}
                className="w-auto p-1.5 flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div role="group" aria-label="Note colour" className="flex items-center gap-1">
                  {NOTE_TONES.map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      data-testid={`note-color-${tone}-${nodeData.note.id}`}
                      aria-label={NOTE_TONE_STYLES[tone].label}
                      aria-pressed={nodeData.tone === tone}
                      title={NOTE_TONE_STYLES[tone].label}
                      onClick={() => {
                        nodeData.onUpdateTone?.(tone);
                        setColorOpen(false);
                      }}
                      className={cn(
                        'size-5 rounded-full border flex items-center justify-center cursor-pointer hover:scale-110 transition-transform',
                        NOTE_TONE_STYLES[tone].swatch,
                        nodeData.tone === tone && 'ring-2 ring-ring ring-offset-1',
                      )}
                    >
                      {nodeData.tone === tone && <Check className="size-2.5 text-primary" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <button
            type="button"
            data-testid={`note-collapse-btn-${nodeData.note.id}`}
            aria-label="Collapse note"
            title="Collapse to comment bubble"
            onClick={(e) => {
              e.stopPropagation();
              setPinned(false);
              setHovered(false);
            }}
            className="nodrag nopan pointer-events-auto size-5 flex items-center justify-center rounded hover:bg-black/5 text-secondary-text hover:text-foreground cursor-pointer"
          >
            <Minimize2 className="size-2.5" />
          </button>
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
          <div role="toolbar" aria-label="Text formatting" className="flex items-center gap-0.5 mb-1">
            {FORMAT_ACTIONS.map(({ kind, label, shortcut, Icon }) => (
              <button
                key={kind}
                type="button"
                data-testid={`note-format-${kind}`}
                aria-label={label}
                title={shortcut ? `${label} (${IS_MAC ? '⌘' : 'Ctrl+'}${shortcut})` : label}
                // Keep focus in the textarea: a blur would commit the edit.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => format(kind)}
                className="size-5 flex items-center justify-center rounded hover:bg-black/5 text-secondary-text hover:text-foreground cursor-pointer"
              >
                <Icon className="size-3" />
              </button>
            ))}
            <span className="ml-auto text-[9px] font-mono text-secondary-text">Markdown</span>
          </div>
          <textarea
            ref={textareaRef}
            data-testid="dock-note-input"
            data-note-id={nodeData.note.id}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              const mod = e.metaKey || e.ctrlKey;
              const shortcut = mod ? FORMAT_ACTIONS.find((a) => a.shortcut?.toLowerCase() === e.key.toLowerCase()) : undefined;
              if (shortcut) {
                e.preventDefault();
                format(shortcut.kind);
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                setEditText(nodeData.text);
                setIsEditing(false);
              }
            }}
            className="w-full bg-background/80 rounded border border-ring p-1.5 text-xs text-foreground font-sans outline-none resize-none leading-relaxed"
            rows={Math.max(2, editText.split('\n').length)}
          />
          <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-secondary-text">
            <span>↵ save · Esc cancel</span>
          </div>
        </div>
      ) : (
        <NoteMarkdown
          data-testid={`note-text-${nodeData.note.id}`}
          text={nodeData.text}
          className="font-sans text-xs select-none space-y-1 break-words"
        />
      )}
    </div>
  );
}
