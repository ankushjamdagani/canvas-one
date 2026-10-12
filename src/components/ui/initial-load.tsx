import * as React from 'react';
import { CanvasOneFace } from './canvas-one-face';
import { initialLoadExpired } from '@/lib/motion/initial-load';

const InitialLoadContext = React.createContext<() => boolean>(() => false);
export const useSkipInitialEntrance = () => React.useContext(InitialLoadContext);

/** Children prepare their entrance in layout effects before this overlay lifts. */
export function InitialLoad({ children }: { children: React.ReactNode }) {
  const loader = React.useRef<HTMLDivElement>(null);
  const prepared = React.useRef(false);
  const skip = React.useCallback(() => !prepared.current && initialLoadExpired(), []);
  React.useLayoutEffect(() => {
    prepared.current = true;
    if (window.__canvasInitialLoad) window.clearTimeout(window.__canvasInitialLoad.timer);
    if (loader.current) loader.current.hidden = true;
  }, []);
  return (
    <InitialLoadContext.Provider value={skip}>
      <div ref={loader} data-initial-loader className="initial-load-overlay" role="status" aria-label="Loading Canvas One" suppressHydrationWarning>
        <CanvasOneFace size={64} expression="wink" transition={false} />
      </div>
      {children}
    </InitialLoadContext.Provider>
  );
}
