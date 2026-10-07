import * as React from "react";
import {
  Plus,
  ArrowRight,
  FolderOpen,
  LayoutTemplate,
  Trash2,
  Upload,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { Segmented } from "@/components/ui/segmented";
import {
  DraftingAvatar,
  DraftingEmpty,
  DraftingHeading,
  DraftingMain,
  DraftingNavDivider,
  DraftingSheet,
} from "@/components/ui/drafting-sheet";
import type { SessionController } from "../session/controller";
import { formatStudioError } from "../session/formatError";
import { importProjectJson } from "../transfer";
import { formatImportError } from "./importError";

function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
import type {
  Actor,
  StudioRepository,
  ProjectRecord,
} from "../../persistence/studio/types";
import type { Document, Id } from "../../domain/studio/model";
import { EXAMPLE_CATALOG, type ExampleCatalogEntry } from "./exampleCatalog";
import {
  buildThumbnail,
  resolveOpenTarget,
  type OpenTarget,
  type ProjectThumbnail,
} from "./projectCard";

export interface EntryScreenProps {
  session: SessionController;
  repository: StudioRepository;
  mintId: () => string;
  onOpenSuccess?: () => void;
  /** The session's actor (App.tsx), recorded on project.import. */
  actor: Actor;
}

export type ProjectRowItem = {
  readonly project: ProjectRecord;
  readonly status: "ready" | "error";
  /** The branch the card opens (newest open draft, else main). */
  readonly target?: OpenTarget;
  /** Head commit of main, the compare-and-swap token for deleteProject. */
  readonly mainHeadId?: Id | null;
  /** Preview of the opened branch's first view; null when nothing is placed. */
  readonly thumbnail?: ProjectThumbnail | null;
  readonly errorMessage?: string;
  readonly branchName?: string;
  readonly componentCount?: number;
};

const DEFAULT_PROJECT_TITLE = "Untitled";

type ProjectSort = "recent" | "name";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2 hours ago", "Yesterday", "Sep 21": the card's last-saved line. */
export function formatUpdated(updatedAt: number, now: number): string {
  const age = Math.max(0, now - updatedAt);
  if (age < MINUTE) return "Just now";
  if (age < HOUR) return pluralize(Math.floor(age / MINUTE), "minute") + " ago";
  if (age < DAY) return pluralize(Math.floor(age / HOUR), "hour") + " ago";
  if (age < 2 * DAY) return "Yesterday";
  if (age < 7 * DAY) return `${Math.floor(age / DAY)} days ago`;
  return new Date(updatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Stable 0..1 values from a project id, to vary each card's decorative preview. */
function previewSeed(id: string, index: number): number {
  let h = 2166136261 ^ index;
  for (let i = 0; i < id.length; i += 1) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

const THUMB_ACCENTS = [
  "var(--primary)",
  "var(--purple)",
  "#B5623F",
  "#3A4A45",
] as const;

function accentFor(kind: string): string {
  let h = 0;
  for (let i = 0; i < kind.length; i += 1)
    h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  return THUMB_ACCENTS[h % THUMB_ACCENTS.length];
}

const DOT_BACKGROUND = {
  backgroundImage: "radial-gradient(circle, #E4DFD6 1px, transparent 1.2px)",
  backgroundSize: "12px 12px",
  backgroundPosition: "6px 6px",
} as const;

/** The project's placed nodes and connections, scaled to the card. */
function ProjectPreview({
  thumbnail,
}: {
  thumbnail: ProjectThumbnail | null | undefined;
}) {
  return (
    <div
      data-testid="project-thumbnail"
      data-empty={thumbnail ? undefined : "true"}
      aria-hidden="true"
      className="h-22 overflow-hidden border-b border-hairline bg-background"
      style={DOT_BACKGROUND}
    >
      {thumbnail && (
        <svg
          className="size-full"
          viewBox={`${thumbnail.viewBox.x} ${thumbnail.viewBox.y} ${thumbnail.viewBox.width} ${thumbnail.viewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {thumbnail.edges.map((e, i) => (
            <line
              key={i}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke="rgba(60,70,65,0.35)"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: 1.25 }}
            />
          ))}
          {thumbnail.nodes.map((n, i) => (
            <g key={i}>
              <rect
                x={n.x}
                y={n.y}
                width={n.width}
                height={n.height}
                rx={8}
                fill="var(--background)"
                stroke="var(--hairline)"
                strokeWidth={2}
              />
              <rect
                x={n.x}
                y={n.y}
                width={n.width}
                height={6}
                rx={3}
                fill={accentFor(n.visualKind)}
              />
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

/**
 * 2A "new system" entry screen: two columns.
 *
 * D12/design-revalidation.md §2: no prompt box ("Describe the system…"), no
 * question chips, no team/shared items. The old 2A screen's "Bring in what
 * exists" drop zone is not reproduced (no plausible-defaults auto-build to drop
 * onto); RV-10b instead adds a plain "Import a project" action that runs the
 * contracted project.import flow (JSON v9 bundle only) and surfaces its typed
 * errors, same one the Export submenu's "System as JSON" writes.
 */
export function EntryScreen({
  session,
  repository,
  mintId,
  onOpenSuccess,
  actor,
}: EntryScreenProps) {
  const [projectRows, setProjectRows] = React.useState<
    readonly ProjectRowItem[]
  >([]);
  const [loadingProjects, setLoadingProjects] = React.useState(true);
  const [blankProjectName, setBlankProjectName] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const importFileInputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<ProjectSort>("recent");
  const [dragActive, setDragActive] = React.useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<Id | null>(null);
  const [deletingId, setDeletingId] = React.useState<Id | null>(null);

  // Load existing projects on mount and fetch their open branches via loadHistory
  const refreshProjects = React.useCallback(async () => {
    try {
      setLoadingProjects(true);
      const list = await repository.listProjects();

      const rows: ProjectRowItem[] = await Promise.all(
        list.map(async (project): Promise<ProjectRowItem> => {
          try {
            const history = await repository.loadHistory(project.id);
            const target = resolveOpenTarget(project, history.branches);
            const main = history.branches.find(
              (b) => b.id === project.mainBranchId,
            );
            const opened = history.branches.find(
              (b) => b.id === target.branchId,
            );
            // A missing snapshot only costs the preview, never the card.
            const snapshot = opened
              ? await repository
                  .loadSnapshot(project.id, opened.workingSnapshotId)
                  .catch(() => null)
              : null;
            return {
              project,
              status: "ready",
              target,
              branchName: opened?.label,
              componentCount: snapshot?.document.elements.length,
              mainHeadId: main?.headCommitId ?? null,
              thumbnail: snapshot ? buildThumbnail(snapshot.document) : null,
            };
          } catch (err) {
            console.error(
              `Failed to load history for project ${project.id}:`,
              err,
            );
            return {
              project,
              status: "error",
              errorMessage: formatStudioError(
                err,
                "Failed to load project history",
              ),
            };
          }
        }),
      );

      setProjectRows(rows);
    } catch (err) {
      console.error("Failed to list projects:", err);
      setErrorMessage(formatStudioError(err, "Failed to load projects list"));
    } finally {
      setLoadingProjects(false);
    }
  }, [repository]);

  React.useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  // An empty field creates "Untitled"; the name can be changed from the top bar.
  const trimmedBlankName = blankProjectName.trim() || DEFAULT_PROJECT_TITLE;
  const isBlankNameValid =
    trimmedBlankName.length >= 1 && trimmedBlankName.length <= 80;

  // Blank project creator ("Open an empty canvas")
  const handleCreateBlankProject = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isBlankNameValid || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const blankDoc: Document = {
      schema: "studio-model/1",
      id: mintId(),
      title: trimmedBlankName,
      elements: [],
      connections: [],
      relations: [],
      schemas: [],
      fixtures: [],
      refinements: [],
      scenarios: [],
      views: [],
    };

    try {
      const res = await session.createProject({
        title: trimmedBlankName,
        initialDocument: blankDoc,
      });
      if (res.status === "applied") {
        onOpenSuccess?.();
      } else {
        setErrorMessage(
          formatStudioError(res, "Failed to create blank project"),
        );
      }
    } catch (err) {
      console.error("Unexpected error creating blank project:", err);
      setErrorMessage("An unexpected error occurred while creating project");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Template creator
  const handleCreateExample = async (example: ExampleCatalogEntry) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const fixture = await example.load();
      const res = await session.createProject({
        title: fixture.title,
        initialDocument: fixture,
      });
      if (res.status === "applied") {
        onOpenSuccess?.();
      } else {
        setErrorMessage(
          formatStudioError(res, "Failed to create example project"),
        );
      }
    } catch (err) {
      console.error("Unexpected error creating example project:", err);
      setErrorMessage(
        "An unexpected error occurred while creating example project",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open existing project passing exact branchId
  const handleOpenProject = async (projectId: string, branchId: string) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await session.openProject(projectId, branchId);
      if (res.status === "ready") {
        onOpenSuccess?.();
      } else {
        setErrorMessage(formatStudioError(res, "Failed to open project"));
      }
    } catch (err) {
      console.error("Unexpected error opening project:", err);
      setErrorMessage("An unexpected error occurred while opening project");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete a project and all its records. Two-step (inline confirm); uses the
  // main head read at list time as the CAS token, so a stale row is refused
  // and the list is refreshed instead of deleting newer work.
  const handleDeleteProject = async (row: ProjectRowItem) => {
    if (deletingId || isSubmitting) return;
    setDeletingId(row.project.id);
    setErrorMessage(null);
    try {
      const res = await repository.deleteProject(
        row.project.id,
        row.mainHeadId ?? null,
      );
      if (res.status === "stale") {
        setErrorMessage(
          `"${row.project.title}" changed since this list loaded. Review it, then delete again.`,
        );
      } else if (res.status !== "applied" && res.status !== "missing") {
        setErrorMessage(formatStudioError(res, "Failed to delete project"));
      }
      setConfirmDeleteId(null);
      await refreshProjects();
    } catch (err) {
      console.error("Unexpected error deleting project:", err);
      setErrorMessage("An unexpected error occurred while deleting project");
    } finally {
      setDeletingId(null);
    }
  };

  // Import a portable v9 project JSON bundle (RV-10b): register the file's bytes
  // with the repository's FileToken registry, run project.import, and surface any
  // typed failure (unsupported version, byte cap, validation) without raw exception
  // text. On success, just refresh the project list -- the imported project is not
  // auto-opened.
  const handleImportFile = async (file: File) => {
    if (isImporting || isSubmitting) return;

    setIsImporting(true);
    setErrorMessage(null);

    try {
      const result = await importProjectJson({
        repository,
        file,
        mintId,
        actor,
      });

      if (result.ok) {
        await refreshProjects();
      } else {
        setErrorMessage(formatImportError(result));
      }
    } catch (err) {
      console.error("Unexpected error importing project:", err);
      setErrorMessage(
        "An unexpected error occurred while importing the project",
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFileInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0] ?? null;
    // Reset so selecting the same file again still fires onChange.
    e.target.value = "";
    if (file) void handleImportFile(file);
  };

  const visibleRows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? projectRows.filter((r) =>
          r.project.title.toLowerCase().includes(needle),
        )
      : [...projectRows];
    rows.sort((a, b) =>
      sort === "name"
        ? a.project.title.localeCompare(b.project.title)
        : b.project.updatedAt - a.project.updatedAt,
    );
    return rows;
  }, [projectRows, query, sort]);
  const now = Date.now();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleImportFile(file);
  };

  return (
    <div
      data-testid="entry-screen-root"
      className="min-h-screen w-full max-w-full text-ink"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <DraftingSheet
        page="Projects"
        navigation={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled
              title="Documentation link is not configured"
            >
              Docs
            </Button>
            <DraftingNavDivider />
            <DraftingAvatar
              aria-label={`Local workspace: ${actor.displayName}`}
              title={actor.displayName}
            >
              {actor.displayName.slice(0, 1)}
            </DraftingAvatar>
          </>
        }
      >
        <DraftingMain>
          <div className="flex flex-col gap-5">
            <DraftingHeading>
              Start a project <em>or pick up a sheet.</em>
            </DraftingHeading>

            {errorMessage && (
              <div
                data-testid="entry-error-banner"
                className="p-3 rounded-card border border-risk-edge bg-risk-tint text-destructive text-xs"
                role="alert"
              >
                {errorMessage}
              </div>
            )}

            {/* Start tiles: empty project, starter templates, import */}
            <section
              aria-label="Start a project"
              className="grid grid-cols-1 gap-4 min-[801px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-h-44 [&>*]:min-w-0 [&>*]:rounded-xl"
            >
              <form
                onSubmit={handleCreateBlankProject}
                className="relative flex flex-col p-5 justify-between gap-3 bg-primary text-white transition-colors hover:bg-primary-hover focus-within:ring-2 focus-within:ring-selected-edge"
              >
                <button
                  data-testid="create-blank-project-btn"
                  type="submit"
                  aria-label="Create empty project"
                  className="absolute inset-0 cursor-pointer rounded-[12px] outline-none disabled:cursor-not-allowed"
                  disabled={!isBlankNameValid || isSubmitting}
                />
                <span className="grid size-8 place-items-center rounded-[8px] bg-white/15">
                  <Plus size={18} aria-hidden="true" />
                </span>
                <div className="flex flex-col gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Empty project</h2>
                    <p className="mt-1 text-xs text-white/75">
                      A blank canvas on main. Place parts from the library.
                    </p>
                  </div>
                  <input
                    data-testid="blank-project-name-input"
                    aria-label="Blank project name"
                    type="text"
                    placeholder={DEFAULT_PROJECT_TITLE}
                    value={blankProjectName}
                    onChange={(e) => setBlankProjectName(e.target.value)}
                    maxLength={80}
                    disabled={isSubmitting}
                    className="relative z-10 h-9 pointer-coarse:h-11 w-full rounded-control border border-white/25 bg-white/10 px-3 text-xs text-white placeholder:text-white/55 outline-none focus-visible:border-white/70 focus-visible:bg-white focus-visible:text-ink focus-visible:placeholder:text-secondary-text"
                  />
                </div>
              </form>

              <div className="flex flex-col gap-3 border border-border bg-background p-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-[8px] bg-purple-tint text-purple">
                    <LayoutTemplate size={18} aria-hidden="true" />
                  </span>
                  <h2
                    id="templates-heading"
                    className="flex-1 text-sm font-semibold"
                  >
                    Starter template
                  </h2>
                </div>
                <div
                  data-testid="templates-list"
                  role="list"
                  aria-labelledby="templates-heading"
                  className="max-h-33 overflow-y-auto rounded-lg border border-hairline"
                >
                  {EXAMPLE_CATALOG.map((example) => (
                    <div
                      key={example.id}
                      role="listitem"
                      data-testid={`template-row-${example.id}`}
                      className="flex items-center gap-2 border-b border-hairline bg-background py-1.5 pr-2 pl-3 last:border-b-0 hover:bg-card"
                    >
                      <LayoutTemplate
                        size={13}
                        className="shrink-0 text-purple"
                        aria-hidden="true"
                      />
                      <div className="flex min-w-0 flex-1 items-center gap-2 max-[480px]:flex-col max-[480px]:items-start max-[480px]:gap-0.5">
                        <span
                          className="min-w-0 flex-1 truncate text-xs font-medium max-[480px]:max-w-full"
                          title={example.title}
                        >
                          {example.title}
                        </span>
                        <span className="font-mono text-micro uppercase text-secondary-text shrink-0">
                          {pluralize(example.componentCount, "component")}
                        </span>
                      </div>
                      <Button
                        data-testid={`create-example-${example.id}`}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2.5 text-xs font-medium shrink-0"
                        aria-label={`Create ${example.title}`}
                        disabled={isSubmitting}
                        onClick={() => handleCreateExample(example)}
                      >
                        <span>Create</span>
                        <ArrowRight size={12} aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className={cn(
                  "bg-background relative flex p-5 flex-col justify-between border border-dashed transition-colors focus-within:ring-2 focus-within:ring-selected-edge",
                  dragActive
                    ? "border-primary bg-accent"
                    : "border-border hover:border-hover-border",
                )}
              >
                <button
                  data-testid="import-project-btn"
                  type="button"
                  aria-label="Import project"
                  className="absolute inset-0 cursor-pointer rounded-[12px] outline-none disabled:cursor-wait"
                  disabled={isImporting}
                  onClick={() => importFileInputRef.current?.click()}
                />
                <span className="grid size-8 place-items-center rounded-[8px] bg-sunken text-secondary-text">
                  <Upload size={18} aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">Import .json</h2>
                  <p className="mt-1 text-xs text-secondary-text">
                    Drop a Studio export anywhere on this page, or{" "}
                    <span className="font-medium text-primary">
                      {isImporting ? "importing…" : "browse"}
                    </span>
                    .
                  </p>
                  <input
                    ref={importFileInputRef}
                    data-testid="import-project-file-input"
                    type="file"
                    accept=".json,application/json"
                    aria-label="Import project file"
                    className="hidden"
                    disabled={isImporting}
                    onChange={handleImportFileInputChange}
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Your projects */}
          <section
            aria-labelledby="existing-projects-heading"
            className="flex flex-1 flex-col"
          >
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2
                id="existing-projects-heading"
                className="text-sm font-semibold text-ink"
              >
                Your projects
              </h2>
              <span className="font-mono text-micro text-secondary-text">
                {projectRows.length}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <SearchField
                  aria-label="Search projects"
                  value={query}
                  placeholder="Search projects"
                  shortcut=""
                  onChange={setQuery}
                  onClear={() => setQuery("")}
                  className="w-full sm:w-[240px] bg-background"
                />
                <Segmented
                  aria-label="Sort projects"
                  value={sort}
                  onChange={(v) => setSort(v as ProjectSort)}
                  options={[
                    { id: "recent", label: "Recent" },
                    { id: "name", label: "A–Z" },
                  ]}
                />
              </div>
            </div>

            {loadingProjects ? (
              <div className="p-6 text-center text-xs text-secondary-text bg-background rounded-card border border-border">
                Loading projects…
              </div>
            ) : projectRows.length === 0 ? (
              <DraftingEmpty data-testid="no-projects-notice">
                <FolderOpen
                  size={24}
                  className="mx-auto text-secondary-text/70 mb-2"
                />
                <p className="font-medium text-ink">No saved projects yet</p>
                <p className="mt-0.5">
                  Start from a template, or open an empty canvas.
                </p>
              </DraftingEmpty>
            ) : visibleRows.length === 0 ? (
              <p className="p-8 text-center text-xs text-secondary-text">
                No projects match &ldquo;{query.trim()}&rdquo;.
              </p>
            ) : (
              <div
                data-testid="existing-projects-list"
                className="grid grid-cols-1 gap-4 min-[481px]:grid-cols-2 min-[801px]:grid-cols-3 min-[1101px]:grid-cols-4"
              >
                {visibleRows.map((row) => {
                  const confirming = confirmDeleteId === row.project.id;
                  return (
                    <article
                      key={row.project.id}
                      data-testid={`project-item-${row.project.id}`}
                      className="group relative flex min-w-0 flex-col overflow-hidden rounded-[9px] border border-border bg-card shadow-sm transition-colors hover:border-selected-edge hover:shadow-md"
                    >
                      {row.status === "ready" && row.target && (
                        <button
                          type="button"
                          data-testid={`open-project-${row.project.id}`}
                          data-branch-id={row.target.branchId}
                          aria-label={`Open ${row.project.title}`}
                          disabled={isSubmitting}
                          onClick={() =>
                            handleOpenProject(
                              row.project.id,
                              row.target!.branchId,
                            )
                          }
                          className="absolute inset-0 z-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-wait"
                        />
                      )}
                      <ProjectPreview thumbnail={row.thumbnail} />
                      <div className="pointer-events-none flex flex-col gap-1.5 px-3 py-2.5 [&_button]:pointer-events-auto [&_[role=group]]:pointer-events-auto">
                        <div className="flex items-baseline justify-between gap-3">
                          <h3
                            className="m-0 min-w-0 truncate text-xs font-semibold text-ink"
                            title={row.project.title}
                          >
                            {row.project.title}
                          </h3>
                          <span className="shrink-0 text-micro tracking-normal text-secondary-text">
                            {formatUpdated(row.project.updatedAt, now)}
                          </span>
                        </div>

                        {row.status === "error" && (
                          <span
                            data-testid={`project-error-${row.project.id}`}
                            className="text-xs text-destructive font-medium"
                            role="alert"
                          >
                            {row.errorMessage}
                          </span>
                        )}

                        <div className="flex min-h-7 items-center justify-between gap-2">
                          <span className="min-w-0 flex flex-wrap items-center gap-1.5 text-xs text-secondary-text">
                            <GitBranch size={12} aria-hidden="true" />
                            <span
                              className="max-w-[110px] truncate"
                              title={row.branchName}
                            >
                              {row.branchName}
                            </span>
                            {row.target?.isDraft && (
                              <span className="rounded-tag border border-risk-edge bg-risk-tint px-1.5 font-mono text-micro uppercase text-risk">Draft</span>
                            )}
                          </span>
                          {row.componentCount !== undefined && (
                            <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-micro uppercase text-secondary-text">
                              {pluralize(row.componentCount, "component")}
                            </span>
                          )}
                          {confirming ? (
                            <div
                              role="group"
                              aria-label={`Confirm delete ${row.project.title}`}
                              className="relative z-10 flex items-center gap-1.5"
                            >
                              <Button
                                data-testid={`confirm-delete-project-${row.project.id}`}
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="h-7 px-2.5 text-xs font-semibold"
                                disabled={deletingId !== null}
                                onClick={() => void handleDeleteProject(row)}
                              >
                                {deletingId === row.project.id
                                  ? "Deleting…"
                                  : "Delete"}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2.5 text-xs"
                                disabled={deletingId !== null}
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              data-testid={`delete-project-${row.project.id}`}
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="relative z-10 size-7 text-secondary-text hover:text-destructive"
                              aria-label={`Delete ${row.project.title}`}
                              title="Delete project"
                              disabled={isSubmitting || deletingId !== null}
                              onClick={() => setConfirmDeleteId(row.project.id)}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </DraftingMain>
      </DraftingSheet>
    </div>
  );
}
