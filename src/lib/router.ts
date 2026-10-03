import * as React from 'react';

/** Routes the app understands. `branchId: null` means the project's main branch. */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'project'; readonly projectId: string; readonly branchId: string | null };

export function parseRoute(pathname: string): Route | null {
  const parts = pathname.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] !== 'project' || !parts[1]) return null;
  if (parts.length === 2) return { kind: 'project', projectId: parts[1], branchId: null };
  if (parts.length === 4 && parts[2] === 'branch' && parts[3]) {
    return { kind: 'project', projectId: parts[1], branchId: parts[3] };
  }
  return null;
}

export function formatRoute(route: Route): string {
  if (route.kind === 'home') return '/';
  const project = `/project/${encodeURIComponent(route.projectId)}`;
  return route.branchId ? `${project}/branch/${encodeURIComponent(route.branchId)}` : project;
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const getPathname = () => window.location.pathname;

/** Pushes (or replaces) the browser location; a no-op when already there. */
export function navigate(route: Route, options: { replace?: boolean } = {}) {
  const path = formatRoute(route);
  if (path === window.location.pathname) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  notify();
}

/** Current route; unknown paths read as home (the app rewrites the URL to `/`). */
export function useRoute(): { route: Route; known: boolean } {
  const pathname = React.useSyncExternalStore(subscribe, getPathname);
  return React.useMemo(() => {
    const parsed = parseRoute(pathname);
    return { route: parsed ?? { kind: 'home' }, known: parsed !== null };
  }, [pathname]);
}
