import * as React from 'react';

const PortalRootContext = React.createContext<React.RefObject<HTMLElement | null> | undefined>(undefined);

/** Keep floating controls inside the workspace's CSS and theme boundary. */
export function PortalRootProvider({ root, children }: {
  root: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  return <PortalRootContext.Provider value={root}>{children}</PortalRootContext.Provider>;
}

export function usePortalRoot(): HTMLElement | undefined {
  const root = React.useContext(PortalRootContext);
  return root?.current ?? undefined;
}
