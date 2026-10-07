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
  const stopEnter = React.useRef<(() => void) | null>(null);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || env.reduced || !shell) {
      markReady?.();
      return;
    }
    root.setAttribute(ENTERING_ATTR, '');
    stopEnter.current = runCanvasEnter(root, () => markReady?.(), env.coarse);
    return () => { stopEnter.current?.(); stopEnter.current = null; };
    // Runs once per mount: route changes remount the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (isPresent) return;
    stopEnter.current?.();
    stopEnter.current = null;
    const root = rootRef.current;
    if (!root || env.reduced) {
      safeToRemove?.();
      return;
    }
    let live = true;
    const exit = runCanvasExit(root, env.coarse);
    exit.done.then(
      () => live && safeToRemove?.(),
      () => live && safeToRemove?.(),
    );
    // The page became present again (rapid Forward) or unmounted: undo the exit.
    return () => {
      live = false;
      exit.stop();
    };
  }, [isPresent, env.reduced, env.coarse, rootRef, safeToRemove]);
}
