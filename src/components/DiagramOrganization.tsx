import { AlignEndHorizontal, AlignEndVertical, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignStartHorizontal, AlignStartVertical, CheckSquare2, X } from "lucide-react";
import { alignNodes, distributeNodes, type Alignment, type LayoutAxis, type LayoutNode } from "../domain/canvasLayout";
import { visibleSubsystems } from "../domain/subsystems";
import { useEditor } from "../state/editor";
import { supportsFreeCanvas } from "../domain/model";

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
            <button
              className="diagram-organizer-clear-btn"
              aria-label="Clear component selection"
              title="Clear selection"
              onClick={() => editor.select(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <button
          className={`selection-mode-toggle ${editor.selectionMode ? "active" : ""}`}
          aria-pressed={editor.selectionMode}
          onClick={() => onSelectionModeChange(!editor.selectionMode)}
        >
          <CheckSquare2 size={15} />
          <span>{editor.selectionMode ? "Finish selecting" : "Select components"}</span>
        </button>
      </section>
    );
  }

  return (
    <section className="diagram-organizer" aria-label="Organize components">
      <div className="diagram-organizer-heading">
        <div><strong>{selectedIds.length} selected</strong><span>Drag a box or click cards. Right-click to group.</span></div>
        {selectedIds.length > 0 && <button aria-label="Clear component selection" title="Clear selection" onClick={() => editor.select(null)}><X size={15} /></button>}
      </div>
      <button className={`selection-mode-toggle ${editor.selectionMode ? "active" : ""}`} aria-pressed={editor.selectionMode} onClick={() => onSelectionModeChange(!editor.selectionMode)}>
        <CheckSquare2 size={15} />{editor.selectionMode ? "Finish selecting" : "Select components"}
      </button>
      {editor.selectionMode && <fieldset className="diagram-selection-list">
        <legend>Visible components</legend>
        {visible.map((node) => <label key={node.id}><input type="checkbox" checked={selectedIds.includes(node.id)} onChange={() => onSelectComponent(node.id)} /> <span>{node.name}</span></label>)}
      </fieldset>}
      {selectedIds.length >= 2 && <>
        <div className="organize-actions" aria-label="Alignment actions">
          <button aria-label="Align left" title="Align left edges" disabled={isReadOnly} onClick={() => runAlign("left")}><AlignHorizontalJustifyStart size={16} /></button>
          <button aria-label="Align right" title="Align right edges" disabled={isReadOnly} onClick={() => runAlign("right")}><AlignHorizontalJustifyEnd size={16} /></button>
          <button aria-label="Align top" title="Align top edges" disabled={isReadOnly} onClick={() => runAlign("top")}><AlignStartHorizontal size={16} /></button>
          <button aria-label="Align bottom" title="Align bottom edges" disabled={isReadOnly} onClick={() => runAlign("bottom")}><AlignEndHorizontal size={16} /></button>
        </div>
        <div className="organize-actions" aria-label="Distribution actions">
          <button aria-label="Distribute horizontally" title={horizontal.reason ?? "Distribute with equal horizontal gaps"} disabled={isReadOnly || !horizontal.updates.length} onClick={() => runDistribute("horizontal")}><AlignStartVertical size={16} />Horizontal</button>
          <button aria-label="Distribute vertically" title={vertical.reason ?? "Distribute with equal vertical gaps"} disabled={isReadOnly || !vertical.updates.length} onClick={() => runDistribute("vertical")}><AlignEndVertical size={16} />Vertical</button>
        </div>
        {selectedIds.length >= 3 && horizontal.reason?.startsWith("Not enough") && <p className="organize-reason" role="status">{horizontal.reason}</p>}
        {selectedIds.length >= 3 && vertical.reason?.startsWith("Not enough") && <p className="organize-reason" role="status">{vertical.reason}</p>}
      </>}
    </section>
  );
}
