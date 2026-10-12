'use client';
import * as React from 'react';
import App from '../App';
import { ThemeProvider } from '../lib/theme';
import { MotionProvider } from '../lib/motion/MotionProvider';
import { PortalRootProvider } from '../components/ui/portal-root';
import { acquireRouter, RouterSnapshotProvider } from '../lib/router';
import { InitialLoad } from '../components/ui/initial-load';

/** SSR public pages and browser projects share the original persistent route shell. */
export function StandaloneApp({
  initialPath,
  basePath = '',
  siteOrigin,
}: {
  initialPath: string;
  basePath?: string;
  siteOrigin?: string;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => acquireRouter(basePath), [basePath]);
  const snapshot = React.useMemo(
    () => ({ pathname: `${basePath}${initialPath}`, basePath }),
    [basePath, initialPath],
  );
  return (
    <div className="canvas-one-root" ref={root}>
      <RouterSnapshotProvider value={snapshot}>
        <PortalRootProvider root={root}>
          <ThemeProvider target={root}>
            <MotionProvider>
              <InitialLoad>
                <App basePath={basePath} manageMetadata siteOrigin={siteOrigin} />
              </InitialLoad>
            </MotionProvider>
          </ThemeProvider>
        </PortalRootProvider>
      </RouterSnapshotProvider>
    </div>
  );
}
