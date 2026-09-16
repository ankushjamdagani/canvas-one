import { AlignEndHorizontal, AlignEndVertical, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignStartHorizontal, AlignStartVertical, CheckSquare2, X } from "lucide-react";
import { alignNodes, distributeNodes, type Alignment, type LayoutAxis, type LayoutNode } from "../domain/canvasLayout";
import { visibleSubsystems } from "../domain/subsystems";
import { useEditor } from "../state/editor";
import { supportsFreeCanvas } from "../domain/model";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function DiagramOrganization({ dimensions, onSelectComponent, onSelectionModeChange, onAddNote }: { dimensions: Record<string, { width: number; height: number }>; onSelectComponent: (id: string) => void; onSelectionModeChange: (active: boolean) => void; onAddNote: () => void }) {
  const editor = useEditor();
  if (!supportsFreeCanvas(editor.project.graph)) return null;
  const isReadOnly = editor.readOnly;
  const collapsed = new Set(visibleSubsystems(editor.project).filter((group) => group.collapsed).flatMap((group) => group.nodeIds));
  const visible = editor.project.graph.nodes.filter((node) => !collapsed.has(node.id));
  if (visible.length === 0) return null;
  const layoutNodes: LayoutNode[] = visible.map((node) => ({
    id: node.id,
    position: node.position,
    size: dimensions[node.id] ?? { width: 215, height: 78 },
  }));
  const selectedIds = editor.selectedNodeIds.filter((id) => visible.some((node) => node.id === id));
  const runAlign = (alignment: Alignment) => {
    if (isReadOnly) return;
    const result = alignNodes(layoutNodes, selectedIds, alignment);
    if (result.updates.length) editor.applyNodePositions(result.updates);
  };
  const runDistribute = (axis: LayoutAxis) => {
    if (isReadOnly) return;
    const result = distributeNodes(layoutNodes, selectedIds, axis);
    if (result.updates.length) editor.applyNodePositions(result.updates);
  };
  const horizontal = distributeNodes(layoutNodes, selectedIds, "horizontal");
  const vertical = distributeNodes(layoutNodes, selectedIds, "vertical");
  const isExpanded = editor.selectionMode || selectedIds.length >= 2;

  if (!isExpanded) {
    return (
      <section className="diagram-organizer compact" aria-label="Organize components">
        {selectedIds.length === 1 && (
          <div className="diagram-organizer-compact-row">
            <span className="diagram-organizer-count">1 selected</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="diagram-organizer-clear-btn h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              aria-label="Clear component selection"
              title="Clear selection"
              onClick={() => editor.select(null)}
            >
              <X size={14} />
            </Button>
          </div>
        )}
        <Button
          type="button"
          variant={editor.selectionMode ? "default" : "outline"}
          size="sm"
          className={`selection-mode-toggle h-7 px-2 text-xs gap-1.5 ${editor.selectionMode ? "active" : ""}`}
          aria-pressed={editor.selectionMode}
          onClick={() => onSelectionModeChange(!editor.selectionMode)}
        >
          <CheckSquare2 size={14} />
          <span>{editor.selectionMode ? "Finish selecting" : "Select components"}</span>
        </Button>
      </section>
    );
  }

  return (
    <section className="diagram-organizer" aria-label="Organize components">
      <div className="diagram-organizer-heading">
        <div><strong>{selectedIds.length} selected</strong><span>Drag a box or click cards. Right-click to group.</span></div>
        {selectedIds.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear component selection"
            title="Clear selection"
            onClick={() => editor.select(null)}
          >
            <X size={15} />
          </Button>
        )}
      </div>
      <Button
        type="button"
        variant={editor.selectionMode ? "default" : "outline"}
        size="sm"
        className={`selection-mode-toggle h-7 px-2 text-xs gap-1.5 ${editor.selectionMode ? "active" : ""}`}
        aria-pressed={editor.selectionMode}
        onClick={() => onSelectionModeChange(!editor.selectionMode)}
      >
        <CheckSquare2 size={14} />
        <span>{editor.selectionMode ? "Finish selecting" : "Select components"}</span>
      </Button>
      {editor.selectionMode && (
        <fieldset className="diagram-selection-list">
          <legend>Visible components</legend>
          {visible.map((node) => {
            const isChecked = selectedIds.includes(node.id);
            return (
              <label key={node.id} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer select-none">
                <Checkbox
                  id={`org-node-${node.id}`}
                  aria-label={node.name}
                  checked={isChecked}
                  onCheckedChange={(checked) => {
                    if (checked !== isChecked) {
                      onSelectComponent(node.id);
                    }
                  }}
                />
                <span>{node.name}</span>
              </label>
            );
          })}
        </fieldset>
      )}
      {selectedIds.length >= 2 && <>
        <div className="organize-actions flex items-center gap-1" aria-label="Alignment actions">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 p-0"
            aria-label="Align left"
            title="Align left edges"
            disabled={isReadOnly}
            onClick={() => runAlign("left")}
          >
            <AlignHorizontalJustifyStart size={15} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 p-0"
            aria-label="Align right"
            title="Align right edges"
            disabled={isReadOnly}
            onClick={() => runAlign("right")}
          >
            <AlignHorizontalJustifyEnd size={15} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 p-0"
            aria-label="Align top"
            title="Align top edges"
            disabled={isReadOnly}
            onClick={() => runAlign("top")}
          >
            <AlignStartHorizontal size={15} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 p-0"
            aria-label="Align bottom"
            title="Align bottom edges"
            disabled={isReadOnly}
            onClick={() => runAlign("bottom")}
          >
            <AlignEndHorizontal size={15} />
          </Button>
        </div>
        <div className="organize-actions flex items-center gap-1" aria-label="Distribution actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            aria-label="Distribute horizontally"
            title={horizontal.reason ?? "Distribute with equal horizontal gaps"}
            disabled={isReadOnly || !horizontal.updates.length}
            onClick={() => runDistribute("horizontal")}
          >
            <AlignStartVertical size={14} />
            Horizontal
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            aria-label="Distribute vertically"
            title={vertical.reason ?? "Distribute with equal vertical gaps"}
            disabled={isReadOnly || !vertical.updates.length}
            onClick={() => runDistribute("vertical")}
          >
            <AlignEndVertical size={14} />
            Vertical
          </Button>
        </div>
        {selectedIds.length >= 3 && horizontal.reason?.startsWith("Not enough") && <p className="organize-reason" role="status">{horizontal.reason}</p>}
        {selectedIds.length >= 3 && vertical.reason?.startsWith("Not enough") && <p className="organize-reason" role="status">{vertical.reason}</p>}
      </>}
    </section>
  );
}
