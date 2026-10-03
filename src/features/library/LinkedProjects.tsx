import * as React from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LINKED_PROJECT_MIME_TYPE, type LinkedProjectSummary } from './types';

/** D52: other projects the user can place as read-only linked nodes. Stays mounted while hidden. */
export function LinkedProjects({
  projects,
  searchQuery,
  active,
  onPlace,
  onCountChange,
}: {
  readonly projects: readonly LinkedProjectSummary[];
  readonly searchQuery: string;
  readonly active: boolean;
  readonly onPlace: (project: LinkedProjectSummary) => void;
  readonly onCountChange?: (count: number) => void;
}) {
  React.useEffect(() => onCountChange?.(projects.length), [projects.length, onCountChange]);

  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? projects.filter((p) => [p.title, p.team, p.description].some((text) => text.toLowerCase().includes(query)))
    : projects;

  return (
    <section
      aria-label="Linked projects"
      data-testid="library-linked-projects"
      hidden={!active}
      className="p-4 space-y-3"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') event.stopPropagation();
      }}
    >
      <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-widest text-secondary-text">
        <span className="font-medium">Linked projects</span>
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px]">{visible.length}</span>
      </div>
      <p className="text-xs text-secondary-text">
        Place another project as a read-only node. Its title, team and description stay in sync.
      </p>
      {visible.length === 0 ? (
        <p className="py-6 text-center text-xs text-secondary-text">
          {projects.length === 0 ? 'No other projects yet.' : `No projects match “${searchQuery}”`}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((project) => (
            <li
              key={project.id}
              data-testid={`linked-project-row-${project.id}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(LINKED_PROJECT_MIME_TYPE, JSON.stringify({ projectId: project.id, title: project.title }));
                e.dataTransfer.effectAllowed = 'copyMove';
              }}
              className="flex cursor-grab items-start gap-2 rounded-card border border-control-border bg-background p-2.5 active:cursor-grabbing"
            >
              <Link2 className="mt-0.5 size-3.5 shrink-0 text-secondary-text" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{project.title}</div>
                {project.team ? <div className="font-mono text-[10px] text-secondary-text">{project.team}</div> : null}
                {project.description ? (
                  <div className="mt-0.5 line-clamp-2 text-xs text-secondary-text">{project.description}</div>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid={`linked-project-place-${project.id}`}
                aria-label={`Link ${project.title}`}
                onClick={() => onPlace(project)}
              >
                Link
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
