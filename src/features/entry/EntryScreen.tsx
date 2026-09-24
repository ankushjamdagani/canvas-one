import * as React from 'react';
import { Plus, ArrowRight, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { SessionController } from '../session/controller';
import { formatStudioError } from '../session/formatError';

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
import type { StudioRepository, ProjectRecord } from '../../persistence/studio/types';
import type { Document, Id } from '../../domain/studio/model';
import { REFERENCE_EXAMPLES } from './fixtures';

export interface EntryScreenProps {
  session: SessionController;
  repository: StudioRepository;
  mintId: () => string;
  onOpenSuccess?: () => void;
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

export function EntryScreen({ session, repository, mintId, onOpenSuccess }: EntryScreenProps) {
  const [projectRows, setProjectRows] = React.useState<readonly ProjectRowItem[]>([]);
  const [loadingProjects, setLoadingProjects] = React.useState(true);
  const [blankProjectName, setBlankProjectName] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

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

  // Blank project creator
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

  // Example creator
  const handleCreateExample = async (fixture: Document) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
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
          <span className="font-semibold text-sm tracking-[-0.01em]">System Studio</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="w-full max-w-4xl px-4 py-8 sm:py-12 flex flex-col gap-10">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">
            New system
          </h1>
          <p className="text-sm text-secondary-text mt-1.5">
            Create a blank system design, open an existing project, or start from reference examples.
          </p>
        </div>

        {errorMessage && (
          <div
            data-testid="entry-error-banner"
            className="p-3 rounded-card border border-riskEdge bg-riskTint text-destructive text-xs"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        {/* Section 1: Blank Project */}
        <section aria-labelledby="blank-project-heading">
          <h2 id="blank-project-heading" className="text-base font-semibold text-ink mb-3">
            Blank project
          </h2>
          <Card className="border border-control-border bg-panel shadow-raised">
            <CardHeader className="p-4 sm:p-5 pb-2">
              <CardTitle className="text-sm font-semibold">Start from an empty canvas</CardTitle>
              <CardDescription className="text-xs text-secondary-text">
                Creates a fresh project with no initial views or components.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 pt-2">
              <form onSubmit={handleCreateBlankProject} className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                <Input
                  data-testid="blank-project-name-input"
                  aria-label="Blank project name"
                  type="text"
                  placeholder="Enter project name (1–80 chars)"
                  value={blankProjectName}
                  onChange={(e) => setBlankProjectName(e.target.value)}
                  maxLength={80}
                  className="h-9 px-3 text-xs bg-canvas border-control-border flex-1"
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
                  <span>Create blank project</span>
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>

        {/* Section 2: Reference Examples S01–S05 */}
        <section aria-labelledby="examples-heading">
          <div className="flex items-center justify-between mb-3">
            <h2 id="examples-heading" className="text-base font-semibold text-ink">
              Reference examples
            </h2>
            <span className="text-xs text-secondary-text">S01–S05 system models</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {REFERENCE_EXAMPLES.map((example) => (
              <Card
                key={example.id}
                data-testid={`example-card-${example.id}`}
                className="border border-control-border bg-panel hover:border-hover-border transition-colors flex flex-col justify-between shadow-raised"
              >
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
                      {example.key}
                    </Badge>
                  </div>
                  <CardTitle className="text-sm font-semibold text-ink">
                    {example.title}
                  </CardTitle>
                  <CardDescription className="text-xs text-secondary-text">
                    {pluralize(example.fixture.elements.length, 'component')} · {pluralize(example.fixture.connections.length, 'connection')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                  <Button
                    data-testid={`create-example-${example.id}`}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full h-8 text-xs font-medium flex items-center justify-center gap-1.5"
                    disabled={isSubmitting}
                    onClick={() => handleCreateExample(example.fixture)}
                  >
                    <span>Create</span>
                    <ArrowRight size={13} />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Section 3: Existing Projects */}
        <section aria-labelledby="existing-projects-heading">
          <div className="flex items-center justify-between mb-3">
            <h2 id="existing-projects-heading" className="text-base font-semibold text-ink">
              Existing projects
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
              <p className="mt-0.5">Create a blank project or start from an example above.</p>
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
      </main>
    </div>
  );
}
