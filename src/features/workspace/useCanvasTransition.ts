import * as React from 'react';
import { usePresence } from 'motion/react';
import { useMotionEnv } from '@/lib/motion/env';
import { useRouteShell } from '@/lib/motion/shell-context';
import { ENTERING_ATTR, runCanvasEnter, runCanvasExit } from './canvasTransition';

/** Animates the project canvas in on mount and out when the shell removes the page. */
export function useCanvasTransition(rootRef: React.RefObject<HTMLElement | null>): void {
  const shell = useRouteShell();
  const env = useMotionEnv();
  const [isPresent, safeToRemove] = usePresence();
  const markReady = shell?.markReady;

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || env.reduced || !shell) {
      markReady?.();
      return;
    }
    root.setAttribute(ENTERING_ATTR, '');
    return runCanvasEnter(root, () => markReady?.());
    // Runs once per mount: route changes remount the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isPresent) return;
    const root = rootRef.current;
    if (!root || env.reduced) {
      safeToRemove?.();
      return;
    }
    runCanvasExit(root).then(
      () => safeToRemove?.(),
      () => safeToRemove?.(),
    );
  }, [isPresent, env.reduced, rootRef, safeToRemove]);
}
