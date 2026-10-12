import * as React from 'react';

// Visible by default for server HTML and foundation specimens outside the shell.
export const BoardFrameReadyContext = React.createContext(true);
export const useBoardFrameReady = () => React.useContext(BoardFrameReadyContext);

export interface RouteShellApi {
  beginOpen(el: HTMLElement): void;
  cancelOpen(): void;
  markReady(): void;
  setGroundPaused(paused: boolean): void;
}

export const RouteShellContext = React.createContext<RouteShellApi | null>(null);

/** `null` when rendered outside the shell (Storybook, unit tests). */
export function useRouteShell(): RouteShellApi | null {
  return React.useContext(RouteShellContext);
}

/** Render on pages that never animate a canvas in (errors) so an overlay can leave. */
export function ShellReady(): null {
  const shell = useRouteShell();
  React.useEffect(() => {
    shell?.markReady();
  }, [shell]);
  return null;
}
