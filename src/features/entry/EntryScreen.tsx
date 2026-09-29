import * as React from 'react';
import { Plus, ArrowRight, FolderOpen, LayoutTemplate, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { SessionController } from '../session/controller';
import { formatStudioError } from '../session/formatError';
import { importProjectJson } from '../transfer';
import { formatImportError } from './importError';

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
import type { Actor, StudioRepository, ProjectRecord } from '../../persistence/studio/types';
import type { Document, Id } from '../../domain/studio/model';
import { EXAMPLE_CATALOG, type ExampleCatalogEntry } from './exampleCatalog';

export interface EntryScreenProps {
  session: SessionController;
  repository: StudioRepository;
  mintId: () => string;
  onOpenSuccess?: () => void;
  /** The session's actor (App.tsx), recorded on project.import. */
  actor: Actor;
}

export type OpenBranchChoice = {
  readonly id: Id;
  readonly label: string;
  readonly isMain: boolean;
};

export type ProjectRowItem = {
  readonly project: ProjectRecord;
  readonly status: 'loading' | 'ready' | 'error';
  readonly branches?: readonly OpenBranchChoice[];
  readonly errorMessage?: string;
};

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
export function EntryScreen({ session, repository, mintId, onOpenSuccess, actor }: EntryScreenProps) {
  const [projectRows, setProjectRows] = React.useState<readonly ProjectRowItem[]>([]);
  const [loadingProjects, setLoadingProjects] = React.useState(true);
  const [blankProjectName, setBlankProjectName] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const importFileInputRef = React.useRef<HTMLInputElement>(null);

  // Load existing projects on mount and fetch their open branches via loadHistory
  const refreshProjects = React.useCallback(async () => {
    try {
      setLoadingProjects(true);
      const list = await repository.listProjects();

      const rows: ProjectRowItem[] = await Promise.all(
        list.map(async (project): Promise<ProjectRowItem> => {
          try {
            const history = await repository.loadHistory(project.id);
            const openBranches = history.branches
              .filter((b) => b.state === 'open')
              .map((b) => ({
                id: b.id,
                label: b.id === project.mainBranchId ? 'main' : b.label,
                isMain: b.id === project.mainBranchId,
              }));

            // Main marked "main" first, others sorted by branch label
            openBranches.sort((a, b) => {
              if (a.isMain && !b.isMain) return -1;
              if (!a.isMain && b.isMain) return 1;
              return a.label.localeCompare(b.label);
            });

            return {
              project,
              status: 'ready',
              branches: openBranches,
            };
          } catch (err) {
            console.error(`Failed to load history for project ${project.id}:`, err);
            return {
              project,
              status: 'error',
              errorMessage: formatStudioError(err, 'Failed to load project history'),
            };
          }
        }),
      );

      setProjectRows(rows);
    } catch (err) {
      console.error('Failed to list projects:', err);
      setErrorMessage(formatStudioError(err, 'Failed to load projects list'));
    } finally {
      setLoadingProjects(false);
    }
  }, [repository]);

  React.useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const trimmedBlankName = blankProjectName.trim();
  const isBlankNameValid = trimmedBlankName.length >= 1 && trimmedBlankName.length <= 80;

  // Blank project creator ("Open an empty canvas")
  const handleCreateBlankProject = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isBlankNameValid || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const blankDoc: Document = {
      schema: 'studio-model/1',
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
      if (res.status === 'applied') {
        onOpenSuccess?.();
      } else {
        setErrorMessage(formatStudioError(res, 'Failed to create blank project'));
      }
    } catch (err) {
      console.error('Unexpected error creating blank project:', err);
      setErrorMessage('An unexpected error occurred while creating project');
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
      if (res.status === 'applied') {
        onOpenSuccess?.();
      } else {
        setErrorMessage(formatStudioError(res, 'Failed to create example project'));
      }
    } catch (err) {
      console.error('Unexpected error creating example project:', err);
      setErrorMessage('An unexpected error occurred while creating example project');
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
      if (res.status === 'ready') {
        onOpenSuccess?.();
      } else {
        setErrorMessage(formatStudioError(res, 'Failed to open project'));
      }
    } catch (err) {
      console.error('Unexpected error opening project:', err);
      setErrorMessage('An unexpected error occurred while opening project');
    } finally {
      setIsSubmitting(false);
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
      console.error('Unexpected error importing project:', err);
      setErrorMessage('An unexpected error occurred while importing the project');
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    // Reset so selecting the same file again still fires onChange.
    e.target.value = '';
    if (file) void handleImportFile(file);
  };

  return (
    <div
      data-testid="entry-screen-root"
      className="min-h-screen w-full max-w-full overflow-x-hidden bg-shell text-ink flex flex-col items-center select-none"
    >
      {/* Top Header */}
      <header className="w-full h-[52px] border-b border-border bg-shell px-4 sm:px-8 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <svg
            className="size-5 shrink-0"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="entry-brand-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0B5C54" />
                <stop offset="100%" stopColor="#2E7D6B" />
              </linearGradient>
            </defs>
            <rect width="20" height="20" rx="5" fill="url(#entry-brand-gradient)" />
          </svg>
          <span className="font-semibold text-sm tracking-[-0.01em]">System studio</span>
        </div>
      </header>

      {/* Two-column main content, per 2A new system */}
      <main className="w-full max-w-6xl px-4 py-8 sm:py-12 flex flex-col gap-6">
        {errorMessage && (
          <div
            data-testid="entry-error-banner"
            className="p-3 rounded-card border border-risk-edge bg-risk-tint text-destructive text-xs"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left column: Your projects + Open an empty canvas */}
          <div className="flex flex-col gap-8">
            <section aria-labelledby="existing-projects-heading">
              <div className="flex items-center justify-between mb-3">
                <h2 id="existing-projects-heading" className="text-base font-semibold text-ink">
                  Your projects
                </h2>
                <span className="text-xs text-secondary-text">
                  {pluralize(projectRows.length, 'saved project')}
                </span>
              </div>

              {loadingProjects ? (
                <div className="p-6 text-center text-xs text-secondary-text bg-panel rounded-card border border-control-border">
                  Loading projects…
                </div>
              ) : projectRows.length === 0 ? (
                <div
                  data-testid="no-projects-notice"
                  className="p-8 text-center text-xs text-secondary-text bg-panel rounded-card border border-control-border shadow-raised"
                >
                  <FolderOpen size={24} className="mx-auto text-secondary-text/70 mb-2" />
                  <p className="font-medium text-ink">No saved projects yet</p>
                  <p className="mt-0.5">Start from a template, or open an empty canvas.</p>
                </div>
              ) : (
                <div data-testid="existing-projects-list" className="flex flex-col gap-2">
                  {projectRows.map((row) => (
                    <div
                      key={row.project.id}
                      data-testid={`project-item-${row.project.id}`}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-card border border-control-border bg-panel hover:border-hover-border transition-colors shadow-raised gap-3"
                    >
                      <div className="min-w-0 pr-3">
                        <h3 className="text-sm font-semibold text-ink truncate">
                          {row.project.title}
                        </h3>
                        <p className="text-[11px] text-secondary-text mt-0.5 font-mono">
                          ID: {row.project.id.slice(0, 8)}… · Rev {row.project.revision}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {row.status === 'loading' && (
                          <span className="text-xs text-secondary-text">Loading branches…</span>
                        )}

                        {row.status === 'error' && (
                          <span
                            data-testid={`project-error-${row.project.id}`}
                            className="text-xs text-destructive font-medium"
                            role="alert"
                          >
                            {row.errorMessage}
                          </span>
                        )}

                        {row.status === 'ready' && row.branches && (
                          <div className="flex items-center gap-2 flex-wrap">
                            {row.branches.length === 0 ? (
                              <span className="text-xs text-secondary-text">No open branches</span>
                            ) : (
                              row.branches.map((branch) => (
                                <Button
                                  key={branch.id}
                                  data-testid={`open-branch-${row.project.id}-${branch.isMain ? 'main' : branch.label}`}
                                  data-branch-id={branch.id}
                                  data-branch-label={branch.label}
                                  type="button"
                                  variant={branch.isMain ? 'outline' : 'default'}
                                  size="sm"
                                  className="h-8 px-3 text-xs font-semibold shrink-0"
                                  disabled={isSubmitting}
                                  onClick={() => handleOpenProject(row.project.id, branch.id)}
                                >
                                  Open {branch.label}
                                </Button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="blank-canvas-heading">
              <h2 id="blank-canvas-heading" className="text-base font-semibold text-ink mb-3">
                Open an empty canvas
              </h2>
              <Card className="border border-control-border bg-panel shadow-raised">
                <CardContent className="p-4 sm:p-5">
                  <form onSubmit={handleCreateBlankProject} className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                    <Input
                      data-testid="blank-project-name-input"
                      aria-label="Blank project name"
                      type="text"
                      placeholder="Project name"
                      value={blankProjectName}
                      onChange={(e) => setBlankProjectName(e.target.value)}
                      maxLength={80}
                      className="h-9 pointer-coarse:h-11 px-3 text-xs bg-canvas border-control-border sm:flex-1"
                      disabled={isSubmitting}
                    />
                    <Button
                      data-testid="create-blank-project-btn"
                      type="submit"
                      variant="default"
                      size="sm"
                      className="h-9 px-4 text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
                      disabled={!isBlankNameValid || isSubmitting}
                    >
                      <Plus size={14} />
                      <span>Create</span>
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="import-project-heading">
              <h2 id="import-project-heading" className="text-base font-semibold text-ink mb-3">
                Import a project
              </h2>
              <Card className="border border-control-border bg-panel shadow-raised">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                    <p className="flex-1 text-xs text-secondary-text">
                      Import a project exported as JSON (<code>.system-studio.json</code>).
                    </p>
                    <input
                      ref={importFileInputRef}
                      data-testid="import-project-file-input"
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      disabled={isImporting}
                      onChange={handleImportFileInputChange}
                    />
                    <Button
                      data-testid="import-project-btn"
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 px-4 text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
                      disabled={isImporting}
                      onClick={() => importFileInputRef.current?.click()}
                    >
                      <Upload size={14} />
                      <span>{isImporting ? 'Importing…' : 'Import project'}</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>
          </div>

          {/* Right column: Start from a template */}
          <div className="flex flex-col gap-8">
            <section aria-labelledby="templates-heading">
              <h2 id="templates-heading" className="text-base font-semibold text-ink mb-3">
                Start from a template
              </h2>
              <div data-testid="templates-list" className="flex flex-col gap-2">
                {EXAMPLE_CATALOG.map((example) => (
                  <div
                    key={example.id}
                    data-testid={`template-row-${example.id}`}
                    className="flex items-center justify-between gap-3 p-3.5 rounded-card border border-control-border bg-panel hover:border-hover-border transition-colors shadow-raised"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/*
                        CONTRACT GAP: templates don't have a single visualKind
                        (each combines several component kinds), so they all
                        share one generic template icon rather than inventing
                        a per-template kind mapping.
                      */}
                      <LayoutTemplate size={16} className="text-secondary-text shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
                            {example.key}
                          </Badge>
                          <span className="text-sm font-semibold text-ink truncate">
                            {example.title}
                          </span>
                        </div>
                        <p className="text-xs text-secondary-text mt-0.5">
                          {pluralize(example.componentCount, 'component')} ·{' '}
                          {pluralize(example.scenarioCount, 'scenario')}
                        </p>
                      </div>
                    </div>
                    <Button
                      data-testid={`create-example-${example.id}`}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 px-3 text-xs font-medium flex items-center justify-center gap-1.5 shrink-0"
                      disabled={isSubmitting}
                      onClick={() => handleCreateExample(example)}
                    >
                      <span>Create</span>
                      <ArrowRight size={13} />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
