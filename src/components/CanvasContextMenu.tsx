import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Boxes, Edit2, ChevronRight, ChevronDown, Ungroup } from "lucide-react";
import { useEditor } from "../state/editor";
import { groupingReason } from "../domain/grouping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "./canvasActions.css";

export interface ContextMenuTarget {
  x: number;
  y: number;
  kind: "components" | "subsystem" | "none";
  componentIds?: string[];
  subsystemId?: string;
}

interface CanvasContextMenuProps {
  target: ContextMenuTarget | null;
  onClose: () => void;
  screenToFlowPosition?: (pos: { x: number; y: number }) => { x: number; y: number };
}

export function CanvasContextMenu({ target, onClose, screenToFlowPosition }: CanvasContextMenuProps) {
  const editor = useEditor();
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [formMode, setFormMode] = useState<"create" | "rename" | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [coords, setCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset form on target changes or project change
  useEffect(() => {
    setFormMode(null);
    setNameInput("");
  }, [target, editor.project.id]);

  useEffect(() => {
    if (!target) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (menuRef.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? menuRef.current)?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [target]);

  // Viewport clamping
  useLayoutEffect(() => {
    if (!target) return;
    const padding = 12;
    const menuEl = menuRef.current;
    let width = 240;
    let height = 180;
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
    }
    const maxX = window.innerWidth - width - padding;
    const maxY = window.innerHeight - height - padding;
    setCoords({
      x: Math.max(padding, Math.min(target.x, maxX)),
      y: Math.max(padding, Math.min(target.y, maxY)),
    });
  }, [target, formMode]);

  // Autofocus input when form opens
  useEffect(() => {
    if (formMode) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [formMode]);

  // Dismiss on outside pointer down or Escape
  useEffect(() => {
    if (!target) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (formMode) {
          setFormMode(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [target, formMode, onClose]);

  // Arrow key navigation inside menu
  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (formMode) return;
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length) return;
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = currentIndex < buttons.length - 1 ? currentIndex + 1 : 0;
      buttons[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
      buttons[prevIndex]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      buttons[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  };

  if (!target) return null;

  const subsystems = editor.project.subsystems ?? [];
  const isReadOnly = editor.readOnly;

  let content = null;

  if (target.kind === "components") {
    const selectedIds = target.componentIds ?? [];
    const reason = groupingReason(editor.project, selectedIds);
    const canGroup = !isReadOnly && reason === null;

    if (formMode === "create") {
      content = (
        <form
          className="canvas-menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = nameInput.trim();
            if (trimmed && trimmed.length <= 80 && canGroup) {
              editor.createSubsystem(trimmed, selectedIds);
            }
            onClose();
          }}
        >
          <label className="canvas-menu-form-label" htmlFor="new-subsystem-name">
            New Subsystem
          </label>
          <Input
            id="new-subsystem-name"
            ref={inputRef}
            className="canvas-menu-input h-8 text-xs mb-2"
            maxLength={80}
            required
            placeholder="Subsystem name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <div className="canvas-menu-form-actions flex items-center gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="canvas-menu-btn-secondary h-7 px-2 text-xs"
              onClick={() => setFormMode(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="canvas-menu-btn-primary h-7 px-3 text-xs"
              disabled={!nameInput.trim()}
            >
              Group
            </Button>
          </div>
        </form>
      );
    } else {
      content = (
        <>
          <button
            role="menuitem"
            className="canvas-menu-item"
            disabled={!canGroup}
            onClick={() => {
              setNameInput("Subsystem");
              setFormMode("create");
            }}
          >
            <Boxes size={16} />
            Create subsystem ({selectedIds.length})
          </button>
          {reason && <div className="canvas-menu-hint">{reason}</div>}
        </>
      );
    }
  } else if (target.kind === "subsystem") {
    const group = subsystems.find((s) => s.id === target.subsystemId);
    if (!group) return null;

    if (formMode === "rename") {
      content = (
        <form
          className="canvas-menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = nameInput.trim();
            if (trimmed && trimmed.length <= 80 && !isReadOnly) {
              editor.renameSubsystem(group.id, trimmed);
            }
            onClose();
          }}
        >
          <label className="canvas-menu-form-label" htmlFor="rename-subsystem-name">
            Rename Subsystem
          </label>
          <Input
            id="rename-subsystem-name"
            ref={inputRef}
            className="canvas-menu-input h-8 text-xs mb-2"
            maxLength={80}
            required
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <div className="canvas-menu-form-actions flex items-center gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="canvas-menu-btn-secondary h-7 px-2 text-xs"
              onClick={() => setFormMode(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="canvas-menu-btn-primary h-7 px-3 text-xs"
              disabled={!nameInput.trim() || nameInput.trim() === group.name}
            >
              Save
            </Button>
          </div>
        </form>
      );
    } else {
      content = (
        <>
          <button
            role="menuitem"
            className="canvas-menu-item"
            disabled={isReadOnly}
            onClick={() => {
              setNameInput(group.name);
              setFormMode("rename");
            }}
          >
            <Edit2 size={16} />
            Rename
          </button>
          <button
            role="menuitem"
            className="canvas-menu-item"
            disabled={isReadOnly}
            onClick={() => {
              editor.toggleSubsystem(group.id);
              onClose();
            }}
          >
            {group.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            {group.collapsed ? "Expand subsystem" : "Collapse subsystem"}
          </button>
          <div className="canvas-menu-separator" role="separator" />
          <button
            role="menuitem"
            className="canvas-menu-item"
            disabled={isReadOnly}
            onClick={() => {
              editor.dissolveSubsystem(group.id);
              onClose();
            }}
          >
            <Ungroup size={16} />
            Ungroup
          </button>
        </>
      );
    }
  } else if (target.kind === "none") {
    content = (
      <button
        role="menuitem"
        className="canvas-menu-item"
        disabled={isReadOnly || (editor.project.graph.notes?.length ?? 0) >= 100}
        onClick={() => {
          const flowPos = screenToFlowPosition
            ? screenToFlowPosition({ x: target.x, y: target.y })
            : { x: target.x, y: target.y };
          editor.addNote(flowPos);
          onClose();
        }}
      >
        <Edit2 size={16} />
        Add canvas note
      </button>
    );
  } else {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      className="canvas-context-menu"
      style={{ left: coords.x, top: coords.y }}
      onKeyDown={handleMenuKeyDown}
    >
      {content}
    </div>,
    document.body,
  );
}
