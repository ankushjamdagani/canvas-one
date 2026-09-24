import * as React from 'react';
import type { SessionController } from '../session/controller';
import { formatStudioError } from '../session/formatError';
import { TopBar } from './TopBar';
import { ActivityRail } from './ActivityRail';
import { CanvasView } from './CanvasView';
import { buildMoveChange } from './projection';

export interface WorkspaceProps {
  session: SessionController;
  onBackToProjects: () => void;
}

export function Workspace({ session, onBackToProjects }: WorkspaceProps) {
  // Read session state via useSyncExternalStore
  const sessionState = React.useSyncExternalStore(
    session.subscribe,
    session.getState,
  );

  const document = sessionState.document;
  const [activeViewId, setActiveViewId] = React.useState<string | null>(() => {
    return document?.views?.[0]?.id ?? null;
  });

  // Keep activeViewId valid when views change
  React.useEffect(() => {
    if (!document || !document.views || document.views.length === 0) {
      setActiveViewId(null);
    } else if (!activeViewId || !document.views.some((v) => v.id === activeViewId)) {
      setActiveViewId(document.views[0].id);
    }
  }, [document, activeViewId]);

  const isSaving = sessionState.status === 'saving';
  const hasError = Boolean(sessionState.lastError);

  // Compute save status text without raw exception text
  const saveStatusText = React.useMemo(() => {
    if (isSaving) return 'Saving…';
    if (sessionState.lastError) {
      return formatStudioError(sessionState.lastError, 'Save failed');
    }
    if (sessionState.status === 'ready') return 'Saved';
    return '';
  }, [isSaving, sessionState.lastError, sessionState.status]);

  // Rename project handler
  const handleRenameProject = React.useCallback(
    async (newTitle: string) => {
      return session.renameProject(newTitle);
    },
    [session],
  );

  // Undo / Redo handlers
  const handleUndo = React.useCallback(async () => {
    if (!sessionState.canUndo || isSaving) return;
    await session.undo();
  }, [session, sessionState.canUndo, isSaving]);

  const handleRedo = React.useCallback(async () => {
    if (!sessionState.canRedo || isSaving) return;
    await session.redo();
  }, [session, sessionState.canRedo, isSaving]);

  // Move nodes handler
  const handleMoveNodes = React.useCallback(
    async (
      movedNodes: Array<{ id: string; position: { x: number; y: number } }>,
    ): Promise<boolean> => {
      if (!document || !activeViewId || isSaving) return false;

      const currentView = document.views.find((v) => v.id === activeViewId);
      if (!currentView) return false;

      const change = buildMoveChange(currentView, movedNodes);
      if (!change) return true; // No actual coordinate changes

      const res = await session.apply([change], 'Move');
      return res.status === 'applied';
    },
    [document, activeViewId, isSaving, session],
  );

  // Keyboard shortcuts: Mod+Z / Mod+Shift+Z per commands.md §1
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore during IME composition
      if (e.isComposing) return;

      // Ignore in editable fields
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (!modKey) return;

      if (e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          // Mod+Shift+Z -> Redo
          if (sessionState.canRedo && sessionState.status === 'ready') {
            e.preventDefault();
            void session.redo();
          }
        } else {
          // Mod+Z -> Undo
          if (sessionState.canUndo && sessionState.status === 'ready') {
            e.preventDefault();
            void session.undo();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, sessionState.canUndo, sessionState.canRedo, sessionState.status]);

  return (
    <div
      data-testid="workspace-root"
      className="flex flex-col w-full max-w-full h-screen overflow-hidden bg-shell select-none"
    >
      {/* Top Bar */}
      <TopBar
        projectTitle={document?.title ?? 'Untitled Project'}
        onRenameProject={handleRenameProject}
        onBackToProjects={onBackToProjects}
        saveStatusText={saveStatusText}
        isSaving={isSaving}
        hasError={hasError}
        canUndo={sessionState.canUndo && sessionState.status === 'ready'}
        canRedo={sessionState.canRedo && sessionState.status === 'ready'}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {/* Main Workspace Area: Left Rail + Canvas */}
      <div className="flex flex-1 w-full max-w-full min-h-0 overflow-hidden relative">
        <ActivityRail />

        <main className="flex-1 h-full min-w-0 overflow-hidden relative flex flex-col">
          <CanvasView
            document={document}
            activeViewId={activeViewId}
            onSelectView={setActiveViewId}
            isSaving={isSaving}
            canUndo={sessionState.canUndo && sessionState.status === 'ready'}
            canRedo={sessionState.canRedo && sessionState.status === 'ready'}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onMoveNodes={handleMoveNodes}
          />
        </main>
      </div>
    </div>
  );
}
