'use client';

import * as React from 'react';
import { acquireRouter, normalizeBasePath } from '../lib/router';
import { ThemeProvider } from '../lib/theme';
import { MotionProvider } from '../lib/motion/MotionProvider';
import { PortalRootProvider } from '../components/ui/portal-root';

const App = React.lazy(() => import('../App'));

export interface CanvasOneProps {
  /** Include the host application's deployment prefix, for example /tools/canvas. */
  basePath?: string;
  /** Omit to retain existing standalone projects; set once to isolate host data. */
  storageNamespace?: string;
  publicNavigation?: 'document' | 'client';
  entryRoute?: 'home' | 'projects';
}

/** Browser-only workspace. The host owns routing to this mount and PWA registration. */
export function CanvasOne({
  basePath = '',
  storageNamespace,
  publicNavigation = 'client',
  entryRoute = 'projects',
}: CanvasOneProps) {
  const normalizedPath = normalizeBasePath(basePath);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [mountedPath, setMountedPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    const release = acquireRouter(normalizedPath, {
      publicNavigation,
      entryRoute,
    });
    setMountedPath(normalizedPath);
    return release;
  }, [normalizedPath, publicNavigation, entryRoute]);

  return (
    <div className="canvas-one-root" ref={rootRef}>
      {mountedPath === normalizedPath && (
        <PortalRootProvider root={rootRef}>
          <ThemeProvider target={rootRef} storageNamespace={storageNamespace}>
            <MotionProvider>
              <React.Suspense fallback={<div role="status">Loading Canvas One…</div>}>
                <App
                  key={`${normalizedPath}:${storageNamespace ?? ''}`}
                  storageNamespace={storageNamespace}
                  basePath={normalizedPath}
                />
              </React.Suspense>
            </MotionProvider>
          </ThemeProvider>
        </PortalRootProvider>
      )}
    </div>
  );
}
