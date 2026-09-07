import { useState } from "react";
import { Boxes, ChevronDown, ChevronRight, Ungroup } from "lucide-react";
import { useEditor } from "../state/editor";
import { visibleSubsystems } from "../domain/subsystems";
export function SubsystemsPanel() {
  const editor = useEditor(),
    groups = visibleSubsystems(editor.project);
  const [creating, setCreating] = useState(false),
    [name, setName] = useState("Subsystem"),
    [members, setMembers] = useState<string[]>([]);
  const used = new Set(groups.flatMap((group) => group.nodeIds));
  const available = editor.project.graph.nodes.filter(
    (node) => !used.has(node.id),
  );
  return (
    <details className="subsystems-panel" open={window.innerWidth > 560}>
      <summary className="section-heading">
        <h2>Subsystems</h2>
        <Boxes size={16} />
      </summary>
      {groups.map((group) => (
        <div className="subsystem-library-row" key={group.id}>
          <button
            onClick={() => editor.toggleSubsystem(group.id)}
            aria-label={`${group.collapsed ? "Expand" : "Collapse"} subsystem ${group.name}`}
          >
            {group.collapsed ? (
              <ChevronRight size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
            <span>{group.name}</span>
          </button>
          <button
            aria-label={`Ungroup ${group.name}`}
            title="Ungroup; keep every component"
            onClick={() => editor.dissolveSubsystem(group.id)}
          >
            <Ungroup size={14} />
          </button>
        </div>
      ))}
      {!creating ? (
        <button
          className="subtle"
          disabled={available.length < 2}
          onClick={() => {
            setMembers(
              available
                .filter((node) => node.kind !== "traffic")
                .map((node) => node.id),
            );
            setCreating(true);
          }}
        >
          Create subsystem
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            editor.createSubsystem(name, members);
            setCreating(false);
          }}
        >
          <input
            aria-label="Subsystem name"
            maxLength={80}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <fieldset>
            <legend>Include components</legend>
            {available.map((node) => (
              <label key={node.id}>
                <input
                  type="checkbox"
                  checked={members.includes(node.id)}
                  onChange={(e) =>
                    setMembers(
                      e.target.checked
                        ? [...members, node.id]
                        : members.filter((id) => id !== node.id),
                    )
                  }
                />
                {node.name}
              </label>
            ))}
          </fieldset>
          <div className="internal-edit-actions">
            <button type="submit" disabled={members.length < 2 || !name.trim()}>
              Group components
            </button>
            <button type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <p>Group the view. The model stays the same.</p>
    </details>
  );
}
