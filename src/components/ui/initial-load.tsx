import * as React from 'react';
import { LoadingFace } from './loading-face';
import { dismissInitialLoader, initialLoadExpired } from '@/lib/motion/initial-load';

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
    if (loader.current) dismissInitialLoader(loader.current);
  }, []);
  return (
    <InitialLoadContext.Provider value={skip}>
      <div
        ref={loader}
        data-initial-loader
        className="initial-load-overlay"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2147483647,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--shell, #fbfaf7)',
          color: 'var(--ink, #16201d)',
        }}
        suppressHydrationWarning
        onAnimationEnd={event => {
          if (event.target === event.currentTarget && (event.animationName === 'initial-loader-exit' || event.animationName === 'initial-loader-timeout')) {
            event.currentTarget.hidden = true;
            event.currentTarget.style.display = 'none';
          }
        }}
      >
        <LoadingFace />
      </div>
      {children}
    </InitialLoadContext.Provider>
  );
}
