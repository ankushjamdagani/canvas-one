import * as React from 'react';
import {
  openStudioRepository,
  SessionController,
} from './features/session';
import type { Actor, StudioRepository } from './persistence/studio';
import { EntryScreen } from './features/entry';
import { lazyComponent, whenIdle } from '@/lib/lazyComponent';

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
// (RV-12d: "the app's mintId") instead of defining its own.
export const MINT_ID = () => crypto.randomUUID();

function getOrCreateActorId(): string {
  try {
    const key = 'system-studio.actor-id';
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

export default function App() {
  const [bootState, setBootState] = React.useState<BootState>({ status: 'booting' });

  const runBoot = React.useCallback(async () => {
    setBootState({ status: 'booting' });

    try {
      const bootRes = await openStudioRepository({
        mintId: MINT_ID,
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
        actorId: getOrCreateActorId(),
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
  }, []);

  React.useEffect(() => {
    void runBoot();
  }, [runBoot]);

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
        Loading System Studio…
      </div>
    );
  }

  return (
    <StudioShell
      repository={bootState.repository}
      session={bootState.session}
      actor={bootState.actor}
    />
  );
}

function StudioShell({
  repository,
  session,
  actor,
}: {
  repository: StudioRepository;
  session: SessionController;
  actor: Actor;
}) {
  const sessionState = React.useSyncExternalStore(
    session.subscribe,
    session.getState,
  );
  const [activeScreen, setActiveScreen] = React.useState<'entry' | 'workspace'>('entry');

  React.useEffect(() => whenIdle(() => void Workspace.preload()), []);

  // If a project is loaded and activeScreen is 'workspace', show Workspace
  if (activeScreen === 'workspace' && sessionState.projectId) {
    return (
      <Workspace
        session={session}
        repository={repository}
        onBackToProjects={() => setActiveScreen('entry')}
        mintId={MINT_ID}
        actor={actor}
      />
    );
  }

  // Otherwise, show Entry screen
  return (
    <EntryScreen
      session={session}
      repository={repository}
      mintId={MINT_ID}
      actor={actor}
      onOpenSuccess={() => setActiveScreen('workspace')}
    />
  );
}
