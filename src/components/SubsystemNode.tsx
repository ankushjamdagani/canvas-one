import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Boxes, ChevronDown, ChevronRight } from "lucide-react";
import { useEditor } from "../state/editor";
import type { Subsystem } from "../domain/subsystems";
export type SubsystemCanvasNode = Node<
  { group: Subsystem; queued: number; active: number; hasRun: boolean; diagram: boolean },
  "subsystem"
>;
export function SubsystemNode({ data }: NodeProps<SubsystemCanvasNode>) {
  const toggle = useEditor((state) => state.toggleSubsystem),
    isReadOnly = useEditor((state) => state.readOnly),
    group = data.group;
  return (
    <div
      className={`subsystem-shell ${group.collapsed ? "collapsed" : "open"} relative w-full h-full rounded-[10px] border-selected-edge ${
        group.collapsed ? "border border-solid bg-panel" : "border-[1.5px] border-dashed bg-accent/50"
      }`}
    >
      {group.collapsed && (
        <Handle type="target" position={Position.Left} isConnectable={false} />
      )}
      <div className="subsystem-header">
        <Boxes size={18} />
        <strong>{group.name}</strong>
        <span className="subsystem-count">{group.nodeIds.length} components</span>
        <button
          className="nodrag nopan"
          aria-label={`${group.collapsed ? "Expand" : "Collapse"} ${group.name} on canvas`}
          aria-expanded={!group.collapsed}
          disabled={isReadOnly}
          onClick={(event) => {
            event.stopPropagation();
            if (!isReadOnly) {
              toggle(group.id);
            }
          }}
        >
          {group.collapsed ? (
            <ChevronRight size={17} />
          ) : (
            <ChevronDown size={17} />
          )}
        </button>
      </div>
      {group.collapsed ? (
        <>
          <p>{group.nodeIds.length} components · same model</p>
          {data.diagram ? <div className="subsystem-diagram-summary">Architecture boundary</div> : <div className="subsystem-summary">
            <span>{data.hasRun ? data.queued : "—"} waiting</span>
            <span>{data.hasRun ? data.active : "—"} active</span>
          </div>}
          <small>Expand to edit components and connections.</small>
        </>
      ) : (
        <small className="subsystem-model-note">
          Same model · edit the components inside
        </small>
      )}
      {group.collapsed && (
        <Handle type="source" position={Position.Right} isConnectable={false} />
      )}
    </div>
  );
}
