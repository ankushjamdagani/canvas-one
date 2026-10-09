import * as React from 'react';
import {
  openStudioRepository,
  SessionController,
  formatStudioError,
} from './features/session';
import type { Actor, StudioRepository } from './persistence/studio';
import { EntryScreen } from './features/entry';
import { LandingPage } from './features/entry/LandingPage';
import { BrandPage } from './features/entry/BrandPage';
import { lazyComponent, whenIdle } from '@/lib/lazyComponent';
import { navigate, useRoute } from '@/lib/router';
import { RouteShell } from './features/shell';
import type { PageKind } from '@/lib/motion/direction';
import { ShellReady } from '@/lib/motion/shell-context';

// The workspace (canvas, panels, history, runs) is its own chunk: the entry screen renders
// without it, and it is prefetched once the browser is idle so opening a project stays fast.
const Workspace = lazyComponent<React.ComponentProps<typeof import('./features/workspace/Workspace').Workspace>>(
  () => import('./features/workspace/Workspace').then((module) => module.Workspace),
  <div
    data-testid="workspace-loading-screen"
    className="min-h-screen w-full flex items-center justify-center bg-shell text-xs text-secondary-text"
  >
    Opening project…
  </div>,
);
import { Button } from '@/components/ui/button';

// Exported so the workspace can mint the same kind of id for its RunController
// (the app's mintId) instead of defining its own.
const MINT_ID = () => crypto.randomUUID();

function getOrCreateActorId(storageNamespace?: string): string {
  try {
    const key = storageNamespace ? `${storageNamespace}:system-studio.actor-id` : 'system-studio.actor-id';
    const stored = localStorage.getItem(key);
    if (stored) return stored;
    const fresh = crypto.randomUUID();
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

type BootState =
  | { status: 'booting' }
  | {
      status: 'failed';
      code: 'unavailable' | 'quota';
      message: string;
    }
  | {
      status: 'ready';
      repository: StudioRepository;
      session: SessionController;
      actor: Actor;
    };

export interface AppProps { storageNamespace?: string; basePath?: string; manageMetadata?: boolean; siteOrigin?: string }

export default function App({ storageNamespace, basePath, manageMetadata = false, siteOrigin }: AppProps = {}) {
  const { route } = useRoute();
  React.useEffect(() => {
    if (!manageMetadata) return;
    const publicPage = route.kind === 'home' || route.kind === 'brand';
    document.title = route.kind === 'home' ? 'Canvas One — The shared canvas for engineers and AI' : `${route.kind === 'brand' ? 'Brand' : route.kind === 'projects' ? 'Projects' : 'Workspace'} | Canvas One`;
    for (const [name, content] of [
      ['robots', publicPage ? 'index, follow' : 'noindex, nofollow'],
      ['description', route.kind === 'brand' ? 'Canvas One brand guidelines, visual language and interface foundations.' : 'Beyond chat: The shared canvas for engineers and AI to think, architect, and review systems together.'],
    ]) {
      let element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!element) { element = document.createElement('meta'); element.name = name; document.head.append(element); }
      element.content = content;
    }
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (siteOrigin && publicPage) {
      if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
      canonical.href = `${new URL(siteOrigin).origin}${basePath ?? ''}${route.kind === 'brand' ? '/brand' : '/'}`;
    } else canonical?.remove();
    for (const property of ['og:title', 'og:description']) {
      const element = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (element) element.content = property === 'og:title' ? document.title : document.querySelector<HTMLMetaElement>('meta[name="description"]')!.content;
    }
  }, [route.kind, manageMetadata, siteOrigin, basePath]);
  const [bootState, setBootState] = React.useState<BootState>({ status: 'booting' });

  const runBoot = React.useCallback(async () => {
    setBootState({ status: 'booting' });

    try {
      const bootRes = await openStudioRepository({
        mintId: MINT_ID,
        dbName: storageNamespace ? `${storageNamespace}:system-studio-local-v1` : undefined,
      });

      if (!bootRes.ok) {
        setBootState({
          status: 'failed',
          code: bootRes.code,
          message:
            bootRes.code === 'quota'
              ? 'Storage quota exceeded. Please free up disk space.'
              : 'Database unavailable. Storage could not be initialized.',
        });
        return;
      }

      const actor: Actor = {
        actorId: getOrCreateActorId(storageNamespace),
        kind: 'local-human',
        displayName: 'You',
      };

      const session = new SessionController({
        repository: bootRes.repository,
        mintId: MINT_ID,
        actor,
      });

      setBootState({
        status: 'ready',
        repository: bootRes.repository,
        session,
        actor,
      });
    } catch (err) {
      console.error('Boot error:', err);
      setBootState({
        status: 'failed',
        code: 'unavailable',
        message: 'Database unavailable. Storage could not be initialized.',
      });
    }
  }, [storageNamespace]);

  React.useEffect(() => {
    if (route.kind !== 'home' && route.kind !== 'brand' && bootState.status === 'booting') void runBoot();
  }, [runBoot, route.kind]);

  const renderPage = (kind: PageKind): React.ReactNode => {
    if (kind === 'home') return <LandingPage basePath={basePath} />;
    if (kind === 'brand') return <BrandPage basePath={basePath} />;

  // Full-page error state naming unavailable/quota with a Retry button
  if (bootState.status === 'failed') {
    return (
      <div
        data-testid="boot-error-screen"
        className="min-h-screen w-full flex flex-col items-center justify-center p-6 bg-shell text-ink"
      >
        <div className="max-w-md w-full p-6 rounded-card border border-risk-edge bg-risk-tint text-center shadow-raised">
          <h1
            data-testid="boot-error-title"
            className="text-lg font-bold text-destructive"
          >
            Storage {bootState.code === 'quota' ? 'quota exceeded' : 'unavailable'}
          </h1>
          <p className="text-xs text-secondary-text mt-2">
            {bootState.message} ({bootState.code})
          </p>
          <div className="mt-5">
            <Button
              data-testid="boot-retry-btn"
              onClick={runBoot}
              variant="default"
              size="sm"
            >
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (bootState.status === 'booting') {
    return (
      <div
        data-testid="boot-loading-screen"
        className="min-h-screen w-full flex items-center justify-center bg-shell text-xs text-secondary-text"
      >
        Loading Canvas One…
      </div>
    );
  }

  return (
    <StudioShell
      repository={bootState.repository}
      session={bootState.session}
      actor={bootState.actor}
      pageKind={kind}
    />
  );
  };
  return <RouteShell renderPage={renderPage} />;
}

function StudioShell({
  repository,
  session,
  actor,
  pageKind,
}: {
  repository: StudioRepository;
  session: SessionController;
  actor: Actor;
  pageKind: PageKind;
}) {
  const sessionState = React.useSyncExternalStore(
    session.subscribe,
    session.getState,
  );
  const { route, known } = useRoute();
  const [openError, setOpenError] = React.useState<{ projectId: string; message: string } | null>(null);

  React.useEffect(() => whenIdle(() => void Workspace.preload()), []);

  // Unknown paths fall back to the landing page.
  React.useEffect(() => {
    if (!known) navigate({ kind: 'home' }, { replace: true });
  }, [known]);

  // URL -> session: a project route opens that project and branch when the session is elsewhere.
  const routeProjectId = route.kind === 'project' ? route.projectId : null;
  const routeBranchId = route.kind === 'project' ? route.branchId : null;
  React.useEffect(() => {
    if (!routeProjectId) return;
    const current = session.getState();
    const sameProject = current.projectId === routeProjectId;
    const targetBranchId = routeBranchId ?? (sameProject ? current.mainBranchId : null);
    if (sameProject && current.branchId === targetBranchId) return;
    let cancelled = false;
    setOpenError(null);
    void session
      .openProject(routeProjectId, targetBranchId)
      .then((result) => {
        if (cancelled || result.status === 'ready') return;
        setOpenError({ projectId: routeProjectId, message: formatStudioError(result, 'Failed to open project') });
      })
      .catch((err) => {
        console.error('Unexpected error opening project:', err);
        if (!cancelled) setOpenError({ projectId: routeProjectId, message: 'An unexpected error occurred while opening the project' });
      });
    return () => {
      cancelled = true;
    };
  }, [session, routeProjectId, routeBranchId]);

  // Session -> URL: opening, creating or switching a project or branch moves the address bar.
  const { projectId, branchId, mainBranchId } = sessionState;
  const previousAddress = React.useRef({ projectId, branchId, mainBranchId });
  React.useEffect(() => {
    const previous = previousAddress.current;
    previousAddress.current = { projectId, branchId, mainBranchId };
    if (previous.projectId === projectId && previous.branchId === branchId && previous.mainBranchId === mainBranchId) return;
    if (!projectId || !branchId) return;
    navigate({ kind: 'project', projectId, branchId: branchId === mainBranchId ? null : branchId });
  }, [projectId, branchId, mainBranchId]);

  const goToProject = React.useCallback(() => {
    const state = session.getState();
    if (!state.projectId || !state.branchId) return;
    navigate({
      kind: 'project',
      projectId: state.projectId,
      branchId: state.branchId === state.mainBranchId ? null : state.branchId,
    });
  }, [session]);

  // The shell keeps rendering the project page while it animates out, after the URL has moved on.
  const lastProjectRoute = React.useRef<Extract<typeof route, { kind: 'project' }> | null>(null);
  if (route.kind === 'project') lastProjectRoute.current = route;

  const renderPage = (kind: PageKind): React.ReactNode => {
    if (kind === 'home') return <LandingPage />;
    if (kind === 'brand') return <BrandPage />;
    if (kind === 'projects') {
      return (
        <EntryScreen session={session} repository={repository} mintId={MINT_ID} actor={actor} onOpenSuccess={goToProject} />
      );
    }
    const projectRoute = route.kind === 'project' ? route : lastProjectRoute.current;
    if (!projectRoute) return null;
    if (sessionState.projectId === projectRoute.projectId) {
      return (
        <Workspace
          session={session}
          repository={repository}
          onBackToProjects={() => navigate({ kind: 'projects' })}
          mintId={MINT_ID}
          actor={actor}
        />
      );
    }
    if (openError?.projectId === projectRoute.projectId) {
      return (
        <div
          data-testid="project-route-error"
          className="min-h-screen w-full flex flex-col items-center justify-center gap-3 bg-shell text-ink p-6 text-center"
        >
          <ShellReady />
          <h1 className="text-lg font-bold">Project unavailable</h1>
          <p className="text-xs text-secondary-text max-w-md">{openError.message}</p>
          <Button size="sm" onClick={() => navigate({ kind: 'projects' })}>
            All projects
          </Button>
        </div>
      );
    }
    return (
      <div
        data-testid="workspace-loading-screen"
        className="min-h-screen w-full flex items-center justify-center bg-shell text-xs text-secondary-text"
      >
        Opening project…
      </div>
    );
  };

  return renderPage(pageKind);
}
