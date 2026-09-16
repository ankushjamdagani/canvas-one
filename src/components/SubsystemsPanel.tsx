import { Boxes, ChevronDown, ChevronRight, Ungroup } from "lucide-react";
import { useEditor } from "../state/editor";
import { visibleSubsystems } from "../domain/subsystems";
import { isDiagramGraph } from "../domain/model";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function SubsystemsPanel() {
  const editor = useEditor();
  const allSubsystems = editor.project.subsystems ?? [];
  const visible = visibleSubsystems(editor.project);
  const visibleIds = new Set(visible.map((g) => g.id));
  const isReadOnly = editor.readOnly;

  return (
    <details className="subsystems-panel" open={window.innerWidth > 560}>
      <summary className="section-heading">
        <h2>Subsystems</h2>
        <Boxes size={16} />
      </summary>
      <div className="subsystems-panel-list">
        {allSubsystems.map((group) => {
          const isVisible = visibleIds.has(group.id);
          return (
            <div className="subsystems-panel-item" key={group.id}>
              <button
                className="subsystems-panel-btn"
                disabled={!isVisible}
                onClick={() => {
                  if (isVisible) {
                    editor.select(group.id);
                    editor.toggleSubsystem(group.id);
                  }
                }}
                aria-label={`${group.collapsed ? "Expand" : "Collapse"} subsystem ${group.name}`}
              >
                {group.collapsed ? (
                  <ChevronRight size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
                <span>{group.name}</span>
                {!isVisible && (
                  <Badge variant="secondary" className="subsystems-badge dormant text-[10px] px-1 py-0 h-4 text-amber-600 dark:text-amber-400" title="Contains missing components">
                    dormant
                  </Badge>
                )}
                <Badge variant="outline" className="subsystems-badge text-[10px] px-1.5 py-0 h-4 font-mono font-normal">
                  {group.nodeIds.length}
                </Badge>
              </button>
              <div className="subsystems-actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="subsystems-action-btn h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Ungroup ${group.name}`}
                  title="Ungroup; keep every component"
                  disabled={isReadOnly}
                  onClick={() => editor.dissolveSubsystem(group.id)}
                >
                  <Ungroup size={14} />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="subsystems-instructions">
        Select components on the canvas and right-click (or press Selection actions) to create or manage subsystems.
      </p>
      <p>{isDiagramGraph(editor.project.graph) ? "Draw a named boundary around related components." : "Group the view. The model stays the same."}</p>
    </details>
  );
}
